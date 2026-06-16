import { prisma } from "../db/index.js";
import { sendError } from "../utils/response.js";

/**
 * Gate for actions that require an admin-verified profile (apply, post shift, payout…).
 * Use after `authenticate`. Role-aware so worker and business reuse the same guard.
 * Unverified users keep restrictive (look-only) access; this blocks the gated action.
 * @param {"worker"|"business"} role
 * @returns {import("express").RequestHandler}
 */
const requireVerifiedProfile = (role) => async (req, res, next) => {
  try {
    const model = role === "business" ? prisma.business_profiles : prisma.worker_profiles;
    const profile = await model.findUnique({
      where: { user_id: req.user.id },
      select: { verification_status: true },
    });

    if (!profile) {
      return sendError(res, 403, `Complete your ${role} profile to continue`);
    }
    if (profile.verification_status !== "verified") {
      return sendError(res, 403, `Your ${role} profile must be verified by an admin first`);
    }

    next();
  } catch (err) {
    next(err);
  }
};

export default requireVerifiedProfile;
