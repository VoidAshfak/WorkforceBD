import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";
import * as applicationRepository from "./application.repository.js";

// Shift states that accept new applications
const APPLYABLE_SHIFT_STATUSES = ["published", "applications_open"];
// Application states a worker is allowed to withdraw from
const WITHDRAWABLE_STATUSES = ["pending", "shortlisted"];

/** @param {string} userId */
const getVerifiedWorker = async (userId) => {
  const profile = await applicationRepository.findWorkerProfile(userId);
  if (!profile) throw new AppError("Worker profile not found", 404);
  if (profile.verification_status !== "verified") {
    throw new AppError("Your profile must be verified before applying to shifts", 403);
  }
  return profile;
};

/** Today at local midnight. */
const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Worker applies to a shift. Enforces verification, shift openness,
 * capacity, and the unique (shift, worker) constraint.
 * @param {string} userId
 * @param {{ shift_id: string, note?: string }} data
 */
export const applyToShift = async (userId, { shift_id, note }) => {
  const worker = await getVerifiedWorker(userId);

  const shift = await applicationRepository.findShiftById(shift_id);
  if (!shift) throw new AppError("Shift not found", 404);
  if (!APPLYABLE_SHIFT_STATUSES.includes(shift.status)) {
    throw new AppError("This shift is not accepting applications", 409);
  }
  if (shift.shift_date < today()) throw new AppError("This shift has already passed", 409);

  const accepted = await applicationRepository.countAccepted(shift_id);
  if (accepted >= shift.workers_needed) throw new AppError("This shift is already full", 409);

  const existing = await applicationRepository.findApplication(shift_id, worker.id);
  if (existing) {
    if (existing.status === "withdrawn") {
      // allow re-applying after a prior withdrawal
      const reactivated = await applicationRepository.updateApplication(existing.id, {
        status: "pending",
        note,
        applied_at: new Date(),
      });
      logger.info(`Application re-activated | userId=${userId} shift=${shift_id}`);
      return reactivated;
    }
    throw new AppError("You have already applied to this shift", 409);
  }

  const application = await applicationRepository.createApplication({
    shift_id,
    worker_profile_id: worker.id,
    note,
  });
  logger.info(`Application created | userId=${userId} shift=${shift_id} app=${application.id}`);
  return application;
};

/**
 * Worker's application tracker, paginated and optionally filtered by status.
 * @param {string} userId
 * @param {{ status?: string, page?: number, limit?: number }} query
 */
export const listMyApplications = async (userId, query) => {
  const worker = await applicationRepository.findWorkerProfile(userId);
  if (!worker) throw new AppError("Worker profile not found", 404);

  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 10));
  const skip = (page - 1) * limit;
  const opts = { status: query.status, skip, take: limit };

  const [items, total] = await Promise.all([
    applicationRepository.findWorkerApplications(worker.id, opts),
    applicationRepository.countWorkerApplications(worker.id, { status: query.status }),
  ]);

  return {
    items,
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
};

/**
 * Worker withdraws a pending/shortlisted application.
 * @param {string} userId
 * @param {string} applicationId
 */
export const withdrawApplication = async (userId, applicationId) => {
  const worker = await applicationRepository.findWorkerProfile(userId);
  if (!worker) throw new AppError("Worker profile not found", 404);

  const application = await applicationRepository.findOwnedApplication(applicationId, worker.id);
  if (!application) throw new AppError("Application not found", 404);
  if (!WITHDRAWABLE_STATUSES.includes(application.status)) {
    throw new AppError(`Cannot withdraw an application in '${application.status}' state`, 409);
  }

  const updated = await applicationRepository.updateApplication(applicationId, { status: "withdrawn" });
  logger.info(`Application withdrawn | userId=${userId} app=${applicationId}`);
  return updated;
};
