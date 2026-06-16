import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";
import * as adminRepository from "./admin.repository.js";

/**
 * Sends the verification-decision notification to the profile owner.
 * @param {string} userId
 * @param {"worker"|"business"} type
 * @param {"approve"|"reject"} decision
 * @param {string} [note]
 */
const notifyDecision = (userId, type, decision, note) => {
  const approved = decision === "approve";
  return adminRepository.createNotification({
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
