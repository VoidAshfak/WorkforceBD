import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../db/index.js";
import * as businessRepository from "./business.repository.js";
import { createNotification } from "../notification/notification.service.js";
import { currentCheckinCode } from "../../utils/qrToken.js";

const { ACTIVE_SHIFT_STATUSES } = businessRepository;

// Shift states that may still be edited by the business.
const EDITABLE_SHIFT_STATUSES = ["draft", "published", "applications_open"];
// Terminal/locked states a shift can no longer be cancelled from.
const NON_CANCELLABLE_STATUSES = ["completed", "payment_pending", "paid", "closed", "cancelled"];
// Applicant states a business may still act on.
const DECIDABLE_APPLICATION_STATUSES = ["pending", "shortlisted"];
// Fields a business is allowed to edit on a shift (guards against mass assignment).
const EDITABLE_SHIFT_FIELDS = [
  "title", "description", "category_id", "role_type", "shift_type",
  "pay_amount", "gender_preference", "meal_included", "transport_support",
  "zone_id", "address", "landmark",
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
  return {
    ...rest,
    filled,
    capacity: shift.workers_needed,
    is_full: filled >= shift.workers_needed,
    applicants_waiting: _count?.applications ?? 0,
  };
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

  const status = data.draft ? "draft" : "pending_approval";

  const shift = await businessRepository.createShift({
    business_profile_id: profile.id,
    title: data.title,
    description: data.description ?? null,
    category_id: data.category_id,
    role_type: data.role_type ?? null,
    shift_type: data.shift_type,
    shift_date: shiftDate,
    start_time: timeStringToDate(data.start_time),
    end_time: timeStringToDate(data.end_time),
    pay_amount: data.pay_amount,
    workers_needed: Number(data.workers_needed),
    gender_preference: data.gender_preference ?? null,
    meal_included: data.meal_included ?? false,
    transport_support: data.transport_support ?? false,
    address: data.address ?? profile.address ?? null,
    landmark: data.landmark ?? profile.landmark ?? null,
    zone_id: zoneId,
    status,
    created_by: userId,
  });

  logger.info(`Shift created | userId=${userId} shiftId=${shift.id} status=${status}`);
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
  return toShiftDto(shift);
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

  const updated = await businessRepository.updateShift(shiftId, patch);
  logger.info(`Shift updated | userId=${userId} shiftId=${shiftId}`);
  return toShiftDto(await businessRepository.findOwnedShift(shiftId, profile.id)) ?? updated;
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

  const updated = await businessRepository.updateShift(shiftId, { status: "pending_approval", updated_by: userId });
  logger.info(`Shift submitted for review | userId=${userId} shiftId=${shiftId}`);
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

  const updated = await businessRepository.updateShift(shiftId, {
    status: "cancelled",
    cancellation_reason: reason,
    updated_by: userId,
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
