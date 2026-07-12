import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../db/index.js";
import * as adminRepository from "./admin.repository.js";
import { revokeAllUserSessions } from "../auth/auth.repository.js";
import { refundShiftEscrow } from "../business/business.service.js";
import { createNotification } from "../notification/notification.service.js";
import { listSettings, updateSetting, resetSetting } from "../../config/settings.js";

/**
 * Sends the verification-decision notification to the profile owner.
 * @param {string} userId
 * @param {"worker"|"business"} type
 * @param {"approve"|"reject"} decision
 * @param {string} [note]
 */
const notifyDecision = (userId, type, decision, note) => {
  const approved = decision === "approve";
  return createNotification({
    user_id: userId,
    type: "in_app",
    priority: "high",
    title: approved ? "You're verified!" : "Verification rejected",
    body: approved
      ? `Your ${type} profile has been approved. You now have full access.`
      : `Your ${type} profile was rejected.${note ? ` Reason: ${note}` : ""} Please re-submit your documents.`,
    data: { kind: "verification_decision", profile_type: type, status: approved ? "verified" : "rejected" },
  });
};

/**
 * Paginated review queue of profiles for a given type and status.
 * @param {{ type?: string, status?: string, page?: number, limit?: number }} query
 */
export const listVerifications = async (query) => {
  const type = query.type ?? "worker";
  const status = query.status ?? "pending";
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 10));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    adminRepository.findProfilesForReview({ type, status, skip, take: limit }),
    adminRepository.countProfilesForReview({ type, status }),
  ]);

  return {
    items,
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
};

/**
 * Single profile under review (full document URLs for KYC).
 * @param {"worker"|"business"} type
 * @param {string} profileId
 */
export const getVerification = async (type, profileId) => {
  const profile = await adminRepository.findProfileById(type, profileId);
  if (!profile) throw new AppError("Profile not found", 404);
  return profile;
};

/**
 * Approves or rejects a profile. Flips verification_status and notifies the owner.
 * @param {string} adminId
 * @param {string} profileId
 * @param {{ type: "worker"|"business", decision: "approve"|"reject", note?: string }} data
 */
export const decideVerification = async (adminId, profileId, { type, decision, note }) => {
  const profile = await adminRepository.findProfileById(type, profileId);
  if (!profile) throw new AppError("Profile not found", 404);

  if (profile.verification_status === "verified") {
    throw new AppError("Profile is already verified", 409);
  }

  const newStatus = decision === "approve" ? "verified" : "rejected";
  const updated = await adminRepository.updateVerification(type, profileId, {
    verification_status: newStatus,
    verification_note: note ?? null,
    updated_by: adminId,
  });

  await notifyDecision(profile.user_id, type, decision, note);
  logger.info(`Verification ${newStatus} | type=${type} profileId=${profileId} adminId=${adminId}`);

  return updated;
};

/* ============================================================
 * Shift-post moderation
 * ========================================================== */

/**
 * Notifies a business about the moderation decision on their shift post.
 * @param {string} userId
 * @param {"approve"|"reject"} decision
 * @param {string} shiftTitle
 * @param {string} [note]
 */
const notifyShiftDecision = (userId, decision, shiftTitle, note) => {
  const approved = decision === "approve";
  return createNotification({
    user_id: userId,
    type: "in_app",
    priority: approved ? "high" : "normal",
    title: approved ? "Shift approved" : "Shift needs changes",
    body: approved
      ? `Your shift "${shiftTitle}" is approved and now live for workers.`
      : `Your shift "${shiftTitle}" was not approved.${note ? ` Reason: ${note}` : ""} Edit and resubmit it for review.`,
    data: { kind: "shift_moderation", status: approved ? "published" : "draft" },
  });
};

/**
 * Paginated queue of shift posts awaiting moderation (default: pending_approval).
 * @param {{ status?: string, page?: number, limit?: number }} query
 */
export const listShiftPosts = async (query) => {
  const status = query.status ?? "pending_approval";
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 10));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    adminRepository.findShiftsForReview({ status, skip, take: limit }),
    adminRepository.countShiftsForReview({ status }),
  ]);

  return {
    items,
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
};

/**
 * Approves or rejects a shift post. Approve → published (worker-visible);
 * reject → draft (business edits and resubmits). Notifies the business.
 * @param {string} adminId
 * @param {string} shiftId
 * @param {{ decision: "approve"|"reject", note?: string }} data
 */
export const decideShiftPost = async (adminId, shiftId, { decision, note }) => {
  const shift = await adminRepository.findShiftById(shiftId);
  if (!shift) throw new AppError("Shift not found", 404);
  if (shift.status !== "pending_approval") {
    throw new AppError("Shift is not pending approval", 409);
  }

  const newStatus = decision === "approve" ? "published" : "draft";

  // Approve keeps the escrow held (released later at settlement); reject returns
  // it to the business wallet and flips the shift back to draft atomically.
  const updated = await prisma.$transaction(async (tx) => {
    if (decision === "reject") await refundShiftEscrow(shift, adminId, tx);
    return adminRepository.updateShiftStatus(shiftId, { status: newStatus, updated_by: adminId }, tx);
  });

  await notifyShiftDecision(shift.business_profiles.user_id, decision, shift.title, note);
  logger.info(`Shift post ${decision} | shiftId=${shiftId} status=${newStatus} adminId=${adminId}`);

  return updated;
};

/* ============================================================
 * Platform monitoring (dashboard + analytics)
 * ========================================================== */

/** Headline platform counters for the admin dashboard. */
export const getDashboard = () => adminRepository.collectDashboardCounts();

/**
 * Daily time series over the last `days` days for the dashboard graphs.
 * Every series is zero-filled so charts get one point per calendar day.
 * @param {{ days?: number }} query
 */
export const getAnalytics = async (query) => {
  const days = Math.min(90, Math.max(7, query.days ?? 30));
  // UTC day buckets — matches the DB's date_trunc('day', …) so keys line up.
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));

  const raw = await adminRepository.collectDailySeries(since);

  // day-keyed lookup per series ("YYYY-MM-DD" → row)
  const indexed = Object.fromEntries(
    Object.entries(raw).map(([name, rows]) => [
      name,
      new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), r])),
    ]),
  );

  const series = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(since);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    series.push({
      date: key,
      signups: indexed.signups.get(key)?.count ?? 0,
      shifts_created: indexed.shiftsCreated.get(key)?.count ?? 0,
      payouts_count: indexed.payouts.get(key)?.count ?? 0,
      payouts_amount: indexed.payouts.get(key)?.amount ?? 0,
      fee_count: indexed.fees.get(key)?.count ?? 0,
      fee_amount: indexed.fees.get(key)?.amount ?? 0,
      disputes_raised: indexed.disputes.get(key)?.count ?? 0,
    });
  }
  return { days, since: since.toISOString().slice(0, 10), series };
};

/* ============================================================
 * User management (list / detail / block / unblock)
 * ========================================================== */

/**
 * Paginated, filterable user list for the admin panel.
 * @param {{ role?: string, status?: string, search?: string, page?: number, limit?: number }} query
 */
export const listUsers = async (query) => {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 10));
  const skip = (page - 1) * limit;
  const filters = { role: query.role, status: query.status, search: query.search?.trim() || undefined };

  const [items, total] = await Promise.all([
    adminRepository.findUsers({ ...filters, skip, take: limit }),
    adminRepository.countUsers(filters),
  ]);
  return { items, pagination: { page, limit, total, total_pages: Math.ceil(total / limit) } };
};

/**
 * Single user detail (profiles, wallet, sanction history).
 * @param {string} userId
 */
export const getUserDetail = async (userId) => {
  const user = await adminRepository.findUserDetail(userId);
  if (!user) throw new AppError("User not found", 404);
  const { user_sanctions_user_sanctions_user_idTousers: sanctions, ...rest } = user;
  return { ...rest, sanctions };
};

/**
 * Blocks a user platform-wide: deactivates the account, records a sanction, and
 * kills every live session so no device stays signed in. Any access token
 * already issued dies at its natural expiry (≤15 min); refresh is rejected.
 * @param {string} adminId
 * @param {string} userId
 * @param {{ reason: string, severity?: string }} data
 */
export const blockUser = async (adminId, userId, { reason, severity }) => {
  if (userId === adminId) throw new AppError("You can't block your own account", 409);
  const user = await adminRepository.findUserDetail(userId);
  if (!user) throw new AppError("User not found", 404);
  if (user.roles.includes("admin")) throw new AppError("Admin accounts can't be blocked from here", 403);
  if (!user.is_active) throw new AppError("User is already blocked", 409);

  await prisma.$transaction(async (tx) => {
    await adminRepository.updateUser(userId, { is_active: false, updated_by: adminId }, tx);
    await adminRepository.createSanction({
      user_id: userId,
      sanction_type: "ban",
      reason,
      severity: severity ?? "high",
      issued_by: adminId,
      created_by: adminId,
    }, tx);
    await revokeAllUserSessions(userId, tx);
  });

  logger.info(`User blocked | userId=${userId} adminId=${adminId} reason="${reason}"`);
  return { user_id: userId, is_active: false };
};

/**
 * Unblocks a user: reactivates the account and closes their active sanctions.
 * @param {string} adminId
 * @param {string} userId
 * @param {{ note?: string }} data
 */
export const unblockUser = async (adminId, userId, { note } = {}) => {
  const user = await adminRepository.findUserDetail(userId);
  if (!user) throw new AppError("User not found", 404);
  if (user.is_active) throw new AppError("User is not blocked", 409);

  await prisma.$transaction(async (tx) => {
    await adminRepository.updateUser(userId, { is_active: true, updated_by: adminId }, tx);
    await adminRepository.deactivateSanctions(userId, adminId, tx);
  });

  await createNotification({
    user_id: userId,
    type: "in_app",
    priority: "high",
    title: "Account restored",
    body: `Your account has been unblocked.${note ? ` Note: ${note}` : ""}`,
    data: { kind: "account_unblocked" },
  });
  logger.info(`User unblocked | userId=${userId} adminId=${adminId}`);
  return { user_id: userId, is_active: true };
};

/* ============================================================
 * Platform settings (runtime-tunable constants)
 * ========================================================== */

/** All tunable settings with live values, defaults, and bounds. */
export const getSettings = () => listSettings();

/**
 * Overrides one setting. Applies immediately — no redeploy.
 * @param {string} adminId
 * @param {string} key
 * @param {number} value
 */
export const changeSetting = async (adminId, key, value) => {
  try {
    await updateSetting(key, value, adminId);
  } catch (err) {
    throw new AppError(err.message, 422);
  }
  return (await listSettings()).find((s) => s.key === key);
};

/**
 * Removes an override, reverting the key to its compiled default.
 * @param {string} adminId
 * @param {string} key
 */
export const removeSettingOverride = async (adminId, key) => {
  try {
    await resetSetting(key, adminId);
  } catch (err) {
    throw new AppError(err.message, 422);
  }
  return (await listSettings()).find((s) => s.key === key);
};
