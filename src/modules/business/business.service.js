import { Prisma } from "../../prisma/index.js";
import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../db/index.js";
import {
  BUSINESS_WALLET_SEED_BALANCE,
  MIN_BUSINESS_TOPUP,
  PLATFORM_FEE_PERCENT,
  LARGE_REQUEST_WORKER_THRESHOLD,
} from "../../constants.js";
import * as businessRepository from "./business.repository.js";
import { createNotification } from "../notification/notification.service.js";
import { currentCheckinCode } from "../../utils/qrToken.js";
import { buildRoadmap } from "../../utils/shiftRoadmap.js";

const { ACTIVE_SHIFT_STATUSES } = businessRepository;

// Shift states that may still be edited by the business.
const EDITABLE_SHIFT_STATUSES = ["draft", "published", "applications_open"];

/**
 * A shift is editable while it is in an editable state AND no worker has been
 * hired yet. Once anyone is hired the posting is locked (changing pay, timing,
 * or capacity out from under a hired worker is not allowed).
 * @param {string} status
 * @param {number} hiredCount accepted applications on the shift
 */
const isShiftEditable = (status, hiredCount) =>
  EDITABLE_SHIFT_STATUSES.includes(status) && hiredCount === 0;
// Terminal/locked states a shift can no longer be cancelled from.
const NON_CANCELLABLE_STATUSES = ["completed", "payment_pending", "paid", "closed", "cancelled"];
// Applicant states a business may still act on.
const DECIDABLE_APPLICATION_STATUSES = ["pending", "shortlisted"];
// Fields a business is allowed to edit on a shift (guards against mass assignment).
const EDITABLE_SHIFT_FIELDS = [
  "title", "description", "category_id", "role_type", "shift_type",
  "pay_amount", "gender_preference", "meal_included", "transport_support",
  "uniform_provided", "tips_expected", "experience_required", "languages",
  "customer_facing", "reporting_details", "dress_code", "manager_contact",
  "is_urgent", "zone_id", "address", "landmark",
];

/* ============================================================
 * Helpers
 * ========================================================== */

/** Today at local midnight. */
const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Parses an "HH:MM" string into a Date carrying only the time component
 * (Prisma stores it as TIME). Returns undefined when no value is given.
 * @param {string} [hhmm]
 */
const timeStringToDate = (hhmm) => {
  if (!hhmm) return undefined;
  return new Date(`1970-01-01T${hhmm}:00Z`);
};

/**
 * Full profile for the owner, or 404. Used by read endpoints.
 * @param {string} userId
 */
const getProfileOrThrow = async (userId) => {
  const profile = await businessRepository.findProfileByUserId(userId);
  if (!profile) throw new AppError("Business profile not found", 404);
  return profile;
};

/**
 * Profile identity (id + location defaults), or 404. Used by shift/applicant ops.
 * @param {string} userId
 */
const getProfileSummaryOrThrow = async (userId) => {
  const profile = await businessRepository.findProfileSummary(userId);
  if (!profile) throw new AppError("Create your business profile first", 404);
  return profile;
};

/**
 * Maps a raw shift row to the business-facing DTO with staffing counters.
 * @param {object} shift
 */
const toShiftDto = (shift) => {
  const { applications, _count, ...rest } = shift;
  const filled = applications?.length ?? 0;
  const workerPay = shiftEscrowCost(shift.pay_amount, shift.workers_needed);
  const fee = new Prisma.Decimal(shift.platform_fee ?? 0);
  return {
    ...rest,
    filled,
    capacity: shift.workers_needed,
    is_full: filled >= shift.workers_needed,
    applicants_waiting: _count?.applications ?? 0,
    // Drives the edit button: false once hired or in a locked state.
    is_editable: isShiftEditable(shift.status, filled),
    // Compensation breakdown for the review screen (screen 7).
    cost_breakdown: {
      worker_pay: shift.pay_amount,
      workers_needed: shift.workers_needed,
      total_worker_pay: workerPay,
      platform_fee: fee,
      total_cost: workerPay.plus(fee),
    },
    is_large_request: shift.workers_needed > LARGE_REQUEST_WORKER_THRESHOLD,
  };
};

/* ============================================================
 * Escrow (business wallet funding — screen 7)
 * ========================================================== */

/**
 * Flat estimated cost a shift escrows: pay per worker × full capacity.
 * @param {Prisma.Decimal|string|number} payAmount
 * @param {number} workersNeeded
 * @returns {Prisma.Decimal}
 */
const shiftEscrowCost = (payAmount, workersNeeded) =>
  new Prisma.Decimal(payAmount).times(workersNeeded);

/**
 * Platform commission on the total worker pay of a shift (screen 7 breakdown).
 * Shown to the business at creation; only the worker pay is escrowed today —
 * fee capture is deferred with the payment gateway.
 * @param {Prisma.Decimal|string|number} payAmount
 * @param {number} workersNeeded
 * @returns {Prisma.Decimal}
 */
const shiftPlatformFee = (payAmount, workersNeeded) =>
  shiftEscrowCost(payAmount, workersNeeded).times(PLATFORM_FEE_PERCENT).dividedBy(100).toDecimalPlaces(2);

/**
 * Moves `cost` from the business wallet's spendable balance into `held`. Throws
 * 402 when the wallet can't cover it. Runs inside the caller's transaction.
 * @param {import("../../prisma/index.js").Prisma.TransactionClient} tx
 * @param {string} profileId
 * @param {string} userId
 * @param {Prisma.Decimal} cost
 */
const reserveFromWallet = async (tx, profileId, userId, cost) => {
  const wallet = await businessRepository.ensureBusinessWallet(profileId, userId, BUSINESS_WALLET_SEED_BALANCE, tx);
  if (new Prisma.Decimal(wallet.balance).lessThan(cost)) {
    throw new AppError(
      `Insufficient wallet balance to publish this shift. Required ৳${cost}, available ৳${wallet.balance}. Top up your wallet to continue.`,
      402,
    );
  }
  await businessRepository.updateBusinessWallet(wallet.id, {
    balance: new Prisma.Decimal(wallet.balance).minus(cost),
    held: new Prisma.Decimal(wallet.held).plus(cost),
    updated_by: userId,
  }, tx);
};

/**
 * Returns a held amount from `held` back to spendable balance.
 * @param {import("../../prisma/index.js").Prisma.TransactionClient} tx
 * @param {string} profileId
 * @param {string} userId
 * @param {Prisma.Decimal|string|number} amount
 */
const returnToWallet = async (tx, profileId, userId, amount) => {
  const wallet = await businessRepository.ensureBusinessWallet(profileId, userId, BUSINESS_WALLET_SEED_BALANCE, tx);
  const amt = new Prisma.Decimal(amount);
  await businessRepository.updateBusinessWallet(wallet.id, {
    balance: new Prisma.Decimal(wallet.balance).plus(amt),
    held: new Prisma.Decimal(wallet.held).minus(amt),
    updated_by: userId,
  }, tx);
};

/**
 * Refunds a shift's held escrow back to the business wallet and marks it
 * `refunded`. No-op unless escrow is currently `held` (idempotent). Used when a
 * shift is cancelled or its post is rejected before any work happens.
 * @param {{ id: string, business_profile_id: string, escrow_status: string, escrow_amount: Prisma.Decimal|string|number }} shift
 * @param {string} actorId
 * @param {import("../../prisma/index.js").Prisma.TransactionClient} [tx]
 */
export const refundShiftEscrow = async (shift, actorId, tx = prisma) => {
  if (shift.escrow_status !== "held") return;
  await returnToWallet(tx, shift.business_profile_id, actorId, shift.escrow_amount);
  await businessRepository.updateShift(shift.id, { escrow_status: "refunded", updated_by: actorId }, tx);
  logger.info(`Shift escrow refunded | shiftId=${shift.id} amount=${shift.escrow_amount}`);
};

/**
 * Releases a settled shift's escrow: the actually-paid amount becomes spend, and
 * any unspent remainder (no-shows / unfilled slots) returns to spendable balance.
 * No-op unless escrow is `held`. Must run inside the settlement transaction.
 * @param {import("../../prisma/index.js").Prisma.TransactionClient} tx
 * @param {{ id: string, business_profile_id: string, escrow_status: string, escrow_amount: Prisma.Decimal|string|number }} shift
 * @param {Prisma.Decimal|string|number} totalPaid amount actually paid to workers
 * @param {string} actorId
 */
export const releaseShiftEscrow = async (tx, shift, totalPaid, actorId) => {
  if (shift.escrow_status !== "held") return;
  const wallet = await businessRepository.ensureBusinessWallet(shift.business_profile_id, actorId, BUSINESS_WALLET_SEED_BALANCE, tx);
  const escrow = new Prisma.Decimal(shift.escrow_amount);
  const spent = new Prisma.Decimal(totalPaid);
  const unspent = escrow.minus(spent);

  await businessRepository.updateBusinessWallet(wallet.id, {
    held: new Prisma.Decimal(wallet.held).minus(escrow),
    balance: new Prisma.Decimal(wallet.balance).plus(unspent),
    total_spent: new Prisma.Decimal(wallet.total_spent).plus(spent),
    updated_by: actorId,
  }, tx);
  await businessRepository.updateShift(shift.id, { escrow_status: "released", updated_by: actorId }, tx);
  logger.info(`Shift escrow released | shiftId=${shift.id} spent=${spent} returned=${unspent}`);
};

/**
 * Business wallet snapshot (balance / held / total_spent). Creates the wallet on
 * first access, seeded with the starting balance.
 * @param {string} userId
 */
export const getWallet = async (userId) => {
  const profile = await getProfileSummaryOrThrow(userId);
  return businessRepository.ensureBusinessWallet(profile.id, userId, BUSINESS_WALLET_SEED_BALANCE);
};

/**
 * Tops up the business wallet's spendable balance. Placeholder funding: the credit
 * is applied instantly with no external capture — real MFS gateway authorization
 * (bKash/Nagad corporate) is wired in later. `method` is recorded only for the log.
 * @param {string} userId
 * @param {{ amount: number, method?: string }} data
 */
export const topUpWallet = async (userId, { amount, method }) => {
  const profile = await getProfileSummaryOrThrow(userId);
  const amt = new Prisma.Decimal(amount);
  if (amt.lessThan(MIN_BUSINESS_TOPUP)) {
    throw new AppError(`Minimum top-up is ৳${MIN_BUSINESS_TOPUP}`, 400);
  }

  const wallet = await businessRepository.ensureBusinessWallet(profile.id, userId, BUSINESS_WALLET_SEED_BALANCE);
  const updated = await businessRepository.updateBusinessWallet(wallet.id, {
    balance: new Prisma.Decimal(wallet.balance).plus(amt),
    updated_by: userId,
  });
  logger.info(`Business wallet topped up | userId=${userId} amount=${amt} method=${method ?? "manual"}`);
  return updated;
};

/* ============================================================
 * Profile (onboarding wizard — screens 3–6, 17)
 * ========================================================== */

/**
 * Full business profile (screen 17).
 * @param {string} userId
 */
export const getProfile = (userId) => getProfileOrThrow(userId);

/**
 * Step 1 — creates the business profile. One profile per user.
 * @param {string} userId
 * @param {{ business_name: string, business_type?: string, manager_name?: string, manager_phone?: string, logo_url?: string }} data
 */
export const createProfile = async (userId, data) => {
  const existing = await businessRepository.findProfileSummary(userId);
  if (existing) throw new AppError("Business profile already exists", 409);

  const profile = await businessRepository.createProfile(userId, data);
  logger.info(`Business profile created | userId=${userId} profileId=${profile.id}`);
  return profile;
};

/**
 * Step 2 — saves the operating location and zone (screen 4).
 * @param {string} userId
 * @param {{ zone_id?: string, address?: string, landmark?: string }} data
 */
export const updateLocation = async (userId, data) => {
  const profile = await getProfileSummaryOrThrow(userId);

  if (data.zone_id) {
    const zone = await businessRepository.findActiveZone(data.zone_id);
    if (!zone) throw new AppError("Invalid zone", 400);
  }

  const updated = await businessRepository.updateProfile(profile.id, { ...data, updated_by: userId });
  logger.info(`Business location updated | userId=${userId}`);
  return updated;
};

/**
 * Step 3 — submits verification documents and moves status to 'pending' (screen 5).
 * Optional step: a business may operate unverified, but verified profiles earn worker trust.
 * @param {string} userId
 * @param {{ trade_license_url?: string, business_doc_url?: string }} data
 */
export const submitDocuments = async (userId, data) => {
  const profile = await getProfileSummaryOrThrow(userId);
  if (profile.verification_status === "verified") throw new AppError("Profile already verified", 400);

  if (!data.trade_license_url && !data.business_doc_url) {
    throw new AppError("Provide at least one verification document", 400);
  }

  const updated = await businessRepository.updateProfile(profile.id, {
    ...data,
    verification_status: "pending",
    updated_by: userId,
  });
  logger.info(`Business documents submitted | userId=${userId} status=pending`);
  return updated;
};

/**
 * Step 4 — saves the perk/attire preferences shown to workers (screen 6).
 * @param {string} userId
 * @param {{ meal_included?: boolean, transport_support?: boolean, female_friendly?: boolean, uniform_required?: boolean }} data
 */
export const updatePreferences = async (userId, data) => {
  const profile = await getProfileSummaryOrThrow(userId);
  const updated = await businessRepository.updateProfile(profile.id, { ...data, updated_by: userId });
  logger.info(`Business preferences updated | userId=${userId}`);
  return updated;
};

/* ============================================================
 * Shifts (create + manage — screens 8–14)
 * ========================================================== */

/**
 * Creates a shift. Submits it for admin review by default; pass `draft: true` to
 * save a draft. A submitted shift becomes worker-visible only after an admin
 * approves it (`pending_approval` → `published`). Location falls back to the
 * business profile when omitted.
 * @param {string} userId
 * @param {object} data
 */
export const createShift = async (userId, data) => {
  const profile = await getProfileSummaryOrThrow(userId);

  const category = await businessRepository.findActiveCategory(data.category_id);
  if (!category) throw new AppError("Invalid category", 400);

  const zoneId = data.zone_id ?? profile.zone_id ?? null;
  if (zoneId && data.zone_id) {
    const zone = await businessRepository.findActiveZone(zoneId);
    if (!zone) throw new AppError("Invalid zone", 400);
  }

  const shiftDate = new Date(data.shift_date);
  if (shiftDate < today()) throw new AppError("Shift date cannot be in the past", 400);

  const startTime = timeStringToDate(data.start_time);

  // Duplicate guard: same category + date + start time as a live shift usually
  // means a double-tap. Block unless the business confirms it's intentional.
  if (!data.allow_duplicate) {
    const dup = await businessRepository.findDuplicateShift({
      businessProfileId: profile.id,
      categoryId: data.category_id,
      shiftDate,
      startTime,
    });
    if (dup) {
      throw new AppError(
        `You already have a similar shift ("${dup.title}") at this date and time. Resubmit with allow_duplicate=true to post it anyway.`,
        409,
      );
    }
  }

  // Submitting straight to review (not a draft) escrows the shift's full cost now.
  const isSubmitting = !data.draft;
  const status = isSubmitting ? "pending_approval" : "draft";
  const workersNeeded = Number(data.workers_needed);
  const cost = shiftEscrowCost(data.pay_amount, workersNeeded);
  const platformFee = shiftPlatformFee(data.pay_amount, workersNeeded);

  const shiftData = {
    business_profile_id: profile.id,
    title: data.title,
    description: data.description ?? null,
    category_id: data.category_id,
    role_type: data.role_type ?? null,
    shift_type: data.shift_type,
    shift_date: shiftDate,
    start_time: startTime,
    end_time: timeStringToDate(data.end_time),
    pay_amount: data.pay_amount,
    platform_fee: platformFee,
    workers_needed: workersNeeded,
    gender_preference: data.gender_preference ?? null,
    meal_included: data.meal_included ?? false,
    transport_support: data.transport_support ?? false,
    uniform_provided: data.uniform_provided ?? false,
    tips_expected: data.tips_expected ?? false,
    experience_required: data.experience_required ?? false,
    languages: data.languages ?? [],
    customer_facing: data.customer_facing ?? false,
    reporting_details: data.reporting_details ?? null,
    dress_code: data.dress_code ?? null,
    manager_contact: data.manager_contact ?? profile.manager_phone ?? null,
    is_urgent: data.is_urgent ?? false,
    address: data.address ?? profile.address ?? null,
    landmark: data.landmark ?? profile.landmark ?? null,
    zone_id: zoneId,
    status,
    escrow_amount: isSubmitting ? cost : new Prisma.Decimal(0),
    escrow_status: isSubmitting ? "held" : "none",
    created_by: userId,
  };

  // Drafts hold no money. Submitting reserves the escrow and creates the shift
  // atomically, so a funding failure never leaves an unfunded pending shift.
  // Map pin: use the sent coordinates, else fall back to the business location
  // (same fallback as address/landmark). null when neither is set.
  const coords = (data.latitude != null && data.longitude != null)
    ? { latitude: data.latitude, longitude: data.longitude }
    : await businessRepository.findProfileCoordinates(profile.id);

  const persist = async (client) => {
    const created = await businessRepository.createShift(shiftData, client);
    if (coords) await businessRepository.setShiftCoordinates(created.id, coords.latitude, coords.longitude, client);
    return created;
  };

  const shift = isSubmitting
    ? await prisma.$transaction(async (tx) => {
        await reserveFromWallet(tx, profile.id, userId, cost);
        return persist(tx);
      })
    : await persist();

  logger.info(`Shift created | userId=${userId} shiftId=${shift.id} status=${status}${isSubmitting ? ` escrow=${cost}` : ""}`);
  return shift;
};

/**
 * Business's own shifts, paginated and optionally filtered by status.
 * @param {string} userId
 * @param {{ status?: string, page?: number, limit?: number }} query
 */
export const listShifts = async (userId, query) => {
  const profile = await getProfileSummaryOrThrow(userId);

  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 10));
  const skip = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    businessRepository.findOwnedShifts({ businessProfileId: profile.id, status: query.status, skip, take: limit }),
    businessRepository.countOwnedShifts({ businessProfileId: profile.id, status: query.status }),
  ]);

  return {
    items: rows.map(toShiftDto),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
};

/**
 * Single owned-shift detail. 404 if not owned/missing.
 * @param {string} userId
 * @param {string} shiftId
 */
export const getShift = async (userId, shiftId) => {
  const profile = await getProfileSummaryOrThrow(userId);
  const shift = await businessRepository.findOwnedShift(shiftId, profile.id);
  if (!shift) throw new AppError("Shift not found", 404);
  const dto = toShiftDto(shift);
  // Map-pin coordinates live in a PostGIS column Prisma can't select — read raw.
  dto.coordinates = await businessRepository.findShiftCoordinates(shiftId);
  // Journey bar (screen 13) — ordered status roadmap with the current step.
  dto.roadmap = buildRoadmap(shift.status);
  return dto;
};

/**
 * Edits an owned shift while it is still editable.
 * @param {string} userId
 * @param {string} shiftId
 * @param {object} data
 */
export const updateShift = async (userId, shiftId, data) => {
  const profile = await getProfileSummaryOrThrow(userId);
  const shift = await businessRepository.findOwnedShiftBasic(shiftId, profile.id);
  if (!shift) throw new AppError("Shift not found", 404);
  if (!EDITABLE_SHIFT_STATUSES.includes(shift.status)) {
    throw new AppError(`A '${shift.status}' shift can no longer be edited`, 409);
  }
  // Lock the posting once anyone is hired.
  const hired = await businessRepository.countAcceptedForShift(shiftId);
  if (hired > 0) {
    throw new AppError("This shift can no longer be edited — a worker has already been hired", 409);
  }

  if (data.category_id) {
    const category = await businessRepository.findActiveCategory(data.category_id);
    if (!category) throw new AppError("Invalid category", 400);
  }
  if (data.zone_id) {
    const zone = await businessRepository.findActiveZone(data.zone_id);
    if (!zone) throw new AppError("Invalid zone", 400);
  }
  if (data.shift_date && new Date(data.shift_date) < today()) {
    throw new AppError("Shift date cannot be in the past", 400);
  }

  // Whitelist editable fields — never trust the raw body (no mass-assignment of
  // status, business_profile_id, audit columns, etc.).
  const patch = { updated_by: userId };
  for (const key of EDITABLE_SHIFT_FIELDS) {
    if (data[key] !== undefined) patch[key] = data[key];
  }
  if (data.shift_date) patch.shift_date = new Date(data.shift_date);
  if (data.start_time) patch.start_time = timeStringToDate(data.start_time);
  if (data.end_time) patch.end_time = timeStringToDate(data.end_time);
  if (data.workers_needed !== undefined) patch.workers_needed = Number(data.workers_needed);

  // Keep the fee in step with any pay/capacity change (display breakdown).
  if (data.pay_amount !== undefined || data.workers_needed !== undefined) {
    const pay = data.pay_amount ?? shift.pay_amount;
    const workers = data.workers_needed !== undefined ? Number(data.workers_needed) : shift.workers_needed;
    patch.platform_fee = shiftPlatformFee(pay, workers);
  }

  await businessRepository.updateShift(shiftId, patch);
  // Map-pin move is a separate raw write (PostGIS geography).
  if (data.latitude != null && data.longitude != null) {
    await businessRepository.setShiftCoordinates(shiftId, data.latitude, data.longitude);
  }
  logger.info(`Shift updated | userId=${userId} shiftId=${shiftId}`);
  return getShift(userId, shiftId);
};

/**
 * Submits a draft shift for admin review (draft → pending_approval).
 * @param {string} userId
 * @param {string} shiftId
 */
export const publishShift = async (userId, shiftId) => {
  const profile = await getProfileSummaryOrThrow(userId);
  const shift = await businessRepository.findOwnedShiftBasic(shiftId, profile.id);
  if (!shift) throw new AppError("Shift not found", 404);
  if (shift.status !== "draft") throw new AppError("Only draft shifts can be submitted", 409);

  const cost = shiftEscrowCost(shift.pay_amount, shift.workers_needed);

  // Reserve the escrow and flip status atomically.
  const updated = await prisma.$transaction(async (tx) => {
    await reserveFromWallet(tx, profile.id, userId, cost);
    return businessRepository.updateShift(shiftId, {
      status: "pending_approval",
      escrow_amount: cost,
      escrow_status: "held",
      updated_by: userId,
    }, tx);
  });
  logger.info(`Shift submitted for review | userId=${userId} shiftId=${shiftId} escrow=${cost}`);
  return updated;
};

/**
 * Cancels an owned shift with a reason.
 * @param {string} userId
 * @param {string} shiftId
 * @param {string} reason
 */
export const cancelShift = async (userId, shiftId, reason) => {
  const profile = await getProfileSummaryOrThrow(userId);
  const shift = await businessRepository.findOwnedShiftBasic(shiftId, profile.id);
  if (!shift) throw new AppError("Shift not found", 404);
  if (NON_CANCELLABLE_STATUSES.includes(shift.status)) {
    throw new AppError(`A '${shift.status}' shift cannot be cancelled`, 409);
  }

  // Refund any held escrow and cancel atomically.
  const updated = await prisma.$transaction(async (tx) => {
    await refundShiftEscrow(shift, userId, tx);
    return businessRepository.updateShift(shiftId, {
      status: "cancelled",
      cancellation_reason: reason,
      updated_by: userId,
    }, tx);
  });
  logger.info(`Shift cancelled | userId=${userId} shiftId=${shiftId}`);
  return updated;
};

/* ============================================================
 * Applicants (screening — screens 9, 15)
 * ========================================================== */

/**
 * Notifies a worker about a decision on their application.
 * @param {string} workerUserId
 * @param {"accepted"|"rejected"|"shortlisted"} status
 * @param {string} shiftTitle
 */
const notifyApplicant = (workerUserId, status, shiftTitle) => {
  const copy = {
    accepted: { title: "You're hired!", body: `You have been hired for "${shiftTitle}". Check your shifts for details.` },
    shortlisted: { title: "You've been shortlisted", body: `You were shortlisted for "${shiftTitle}".` },
    rejected: { title: "Application update", body: `Your application for "${shiftTitle}" was not selected this time.` },
  }[status];

  return createNotification({
    user_id: workerUserId,
    type: "in_app",
    priority: status === "accepted" ? "high" : "normal",
    title: copy.title,
    body: copy.body,
    data: { kind: "application_decision", status },
  });
};

/**
 * Applicants for an owned shift, with reputation telemetry.
 * @param {string} userId
 * @param {string} shiftId
 * @param {{ status?: string, page?: number, limit?: number }} query
 */
export const listApplicants = async (userId, shiftId, query) => {
  const profile = await getProfileSummaryOrThrow(userId);
  const shift = await businessRepository.findOwnedShiftBasic(shiftId, profile.id);
  if (!shift) throw new AppError("Shift not found", 404);

  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 10));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    businessRepository.findShiftApplicants({ shiftId, status: query.status, skip, take: limit }),
    businessRepository.countShiftApplicants({ shiftId, status: query.status }),
  ]);

  return {
    items,
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
};

/**
 * Live-attendance roster for an owned shift: every hired worker with their
 * derived check-in state, plus the QR token the business displays on-site.
 * @param {string} userId
 * @param {string} shiftId
 */
export const getShiftRoster = async (userId, shiftId) => {
  const profile = await getProfileSummaryOrThrow(userId);
  const shift = await businessRepository.findOwnedShiftForRoster(shiftId, profile.id);
  if (!shift) throw new AppError("Shift not found", 404);

  const rows = await businessRepository.findShiftRoster(shiftId);
  const roster = rows.map((a) => ({
    assignment_id: a.id,
    worker: a.worker_profiles,
    status: a.checked_out_at ? "checked_out" : a.checked_in_at ? "checked_in" : "waiting",
    checked_in_at: a.checked_in_at,
    checked_out_at: a.checked_out_at,
    checkin_method: a.checkin_method,
  }));
  const checkedIn = rows.filter((a) => a.checked_in_at).length;

  // Rotating on-site code derived from the per-shift secret; the secret itself is
  // never returned. The client re-fetches before `expires_in` to refresh the QR.
  const { code, expires_in } = currentCheckinCode(shift.checkin_qr_token, shift.id);

  return {
    shift: {
      id: shift.id, title: shift.title, status: shift.status,
      shift_date: shift.shift_date, start_time: shift.start_time, end_time: shift.end_time,
      workers_needed: shift.workers_needed,
    },
    checkin_code: code,
    checkin_code_expires_in: expires_in,
    summary: { needed: shift.workers_needed, assigned: rows.length, checked_in: checkedIn },
    roster,
  };
};

/**
 * Resolves an owned, still-decidable application or throws.
 * @param {string} userId
 * @param {string} applicationId
 */
const getDecidableApplication = async (userId, applicationId) => {
  const profile = await getProfileSummaryOrThrow(userId);
  const application = await businessRepository.findOwnedApplication(applicationId, profile.id);
  if (!application) throw new AppError("Applicant not found", 404);
  if (!DECIDABLE_APPLICATION_STATUSES.includes(application.status)) {
    throw new AppError(`This applicant is already '${application.status}'`, 409);
  }
  return application;
};

/**
 * Shortlists an applicant (pending → shortlisted).
 * @param {string} userId
 * @param {string} applicationId
 */
export const shortlistApplicant = async (userId, applicationId) => {
  const application = await getDecidableApplication(userId, applicationId);

  const updated = await businessRepository.updateApplication(applicationId, {
    status: "shortlisted",
    updated_by: userId,
  });
  await notifyApplicant(application.worker_profiles.user_id, "shortlisted", application.shifts.title);
  logger.info(`Applicant shortlisted | userId=${userId} app=${applicationId}`);
  return updated;
};

/**
 * Hires an applicant (→ accepted). Enforces the shift's worker capacity.
 * @param {string} userId
 * @param {string} applicationId
 */
export const acceptApplicant = async (userId, applicationId) => {
  const application = await getDecidableApplication(userId, applicationId);
  const { shifts: shift } = application;

  const accepted = await businessRepository.countAcceptedForShift(shift.id);
  if (accepted >= shift.workers_needed) throw new AppError("This shift is already fully staffed", 409);

  // Hire + materialise the roster assignment atomically so the live-attendance
  // roster always has a row to track (state starts at "waiting for check-in").
  const updated = await prisma.$transaction(async (tx) => {
    const app = await businessRepository.updateApplication(applicationId, {
      status: "accepted",
      updated_by: userId,
    }, tx);
    await businessRepository.upsertAssignment({
      shift_id: shift.id,
      application_id: applicationId,
      worker_profile_id: application.worker_profiles.id,
      created_by: userId,
    }, tx);
    return app;
  });

  await notifyApplicant(application.worker_profiles.user_id, "accepted", shift.title);
  logger.info(`Applicant hired | userId=${userId} app=${applicationId} shift=${shift.id}`);
  return updated;
};

/**
 * Rejects an applicant (→ rejected).
 * @param {string} userId
 * @param {string} applicationId
 */
export const rejectApplicant = async (userId, applicationId) => {
  const application = await getDecidableApplication(userId, applicationId);

  const updated = await businessRepository.updateApplication(applicationId, {
    status: "rejected",
    updated_by: userId,
  });
  await notifyApplicant(application.worker_profiles.user_id, "rejected", application.shifts.title);
  logger.info(`Applicant rejected | userId=${userId} app=${applicationId}`);
  return updated;
};

/**
 * Reverts a shortlisted applicant back to pending (un-shortlist toggle). No
 * notification — this is a private screening change.
 * @param {string} userId
 * @param {string} applicationId
 */
export const unshortlistApplicant = async (userId, applicationId) => {
  const profile = await getProfileSummaryOrThrow(userId);
  const application = await businessRepository.findOwnedApplication(applicationId, profile.id);
  if (!application) throw new AppError("Applicant not found", 404);
  if (application.status !== "shortlisted") {
    throw new AppError(`Only a shortlisted applicant can be moved back to pending (currently '${application.status}')`, 409);
  }

  const updated = await businessRepository.updateApplication(applicationId, {
    status: "pending",
    updated_by: userId,
  });
  logger.info(`Applicant un-shortlisted | userId=${userId} app=${applicationId}`);
  return updated;
};

/**
 * Bulk shortlist or reject applicants on an owned shift in one call. Only
 * still-decidable (pending/shortlisted) owned rows are touched; already-decided
 * or foreign ids are silently skipped and reported in the count. Hiring is
 * intentionally excluded here (capacity must be enforced per-slot via accept).
 * @param {string} userId
 * @param {string} shiftId
 * @param {{ action: "shortlist"|"reject", application_ids: string[] }} data
 */
export const bulkDecideApplicants = async (userId, shiftId, { action, application_ids }) => {
  const profile = await getProfileSummaryOrThrow(userId);
  const shift = await businessRepository.findOwnedShiftBasic(shiftId, profile.id);
  if (!shift) throw new AppError("Shift not found", 404);

  const status = action === "shortlist" ? "shortlisted" : "rejected";
  const apps = await businessRepository.findOwnedApplicationsForBulk(application_ids, profile.id, shiftId);

  if (apps.length > 0) {
    const ids = apps.map((a) => a.id);
    await businessRepository.updateApplicationsStatus(ids, status, userId);
    await Promise.all(
      apps.map((a) => notifyApplicant(a.worker_profiles.user_id, status, a.shifts.title)),
    );
  }

  logger.info(`Bulk ${action} | userId=${userId} shift=${shiftId} updated=${apps.length}/${application_ids.length}`);
  return {
    action,
    requested: application_ids.length,
    updated: apps.length,
    skipped: application_ids.length - apps.length,
  };
};

/* ============================================================
 * Dashboard (screen 8)
 * ========================================================== */

/**
 * Home dashboard counters: active shifts, applicants waiting, understaffed
 * shifts, and today's overall fill rate.
 * @param {string} userId
 */
export const getDashboard = async (userId) => {
  const profile = await getProfileSummaryOrThrow(userId);

  const [activeShifts, applicantsWaiting, staffing] = await Promise.all([
    businessRepository.countOwnedShifts({ businessProfileId: profile.id }),
    businessRepository.countPendingApplicants(profile.id),
    businessRepository.findActiveStaffing(profile.id),
  ]);

  let needed = 0;
  let hired = 0;
  let urgent = 0;
  for (const s of staffing) {
    const filled = s._count.applications;
    needed += s.workers_needed;
    hired += filled;
    if (filled < s.workers_needed) urgent += 1;
  }
  const fillRate = needed > 0 ? Math.round((hired / needed) * 100) : 0;

  logger.debug(`Business dashboard | userId=${userId} active=${activeShifts} waiting=${applicantsWaiting}`);
  return {
    active_shifts: staffing.length,
    total_shifts: activeShifts,
    applicants_waiting: applicantsWaiting,
    urgent_staffing: urgent,
    fill_rate: fillRate,
  };
};
