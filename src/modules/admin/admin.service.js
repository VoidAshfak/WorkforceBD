import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../db/index.js";
import * as adminRepository from "./admin.repository.js";
import { refundShiftEscrow } from "../business/business.service.js";
import { createNotification } from "../notification/notification.service.js";

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
