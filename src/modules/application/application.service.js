import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";
import { createNotification } from "../notification/notification.service.js";
import { CHECKIN_RADIUS_METERS, CHECKIN_GRACE_MINUTES } from "../../constants.js";
import * as applicationRepository from "./application.repository.js";

// Shift states that accept new applications
const APPLYABLE_SHIFT_STATUSES = ["published", "applications_open"];
// Application states a worker is allowed to withdraw from
const WITHDRAWABLE_STATUSES = ["pending", "shortlisted"];
// Shift states where check-in/out is no longer permitted.
const CHECKIN_BLOCKED_SHIFT_STATUSES = ["cancelled", "closed"];

/**
 * Resolves the worker profile for the requesting user.
 * Verification is enforced upstream by the `requireVerifiedProfile` guard.
 * @param {string} userId
 */
const getWorkerProfile = async (userId) => {
  const profile = await applicationRepository.findWorkerProfile(userId);
  if (!profile) throw new AppError("Worker profile not found", 404);
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
  const worker = await getWorkerProfile(userId);

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

/* ============================================================
 * Shift check-in / check-out (Activity tab — live attendance)
 * ========================================================== */

/**
 * Builds the [start − grace, end] check-in window for a shift. Handles
 * overnight shifts (end_time <= start_time rolls the end over to the next day).
 * @param {{ shift_date: Date, start_time: Date, end_time: Date }} shift
 * @returns {{ open: Date, close: Date }}
 */
const checkinWindow = ({ shift_date, start_time, end_time }) => {
  const at = (time) => new Date(Date.UTC(
    shift_date.getUTCFullYear(), shift_date.getUTCMonth(), shift_date.getUTCDate(),
    time.getUTCHours(), time.getUTCMinutes(), time.getUTCSeconds(),
  ));
  const open = at(start_time);
  let close = at(end_time);
  if (close <= open) close = new Date(close.getTime() + 24 * 60 * 60 * 1000);
  open.setMinutes(open.getMinutes() - CHECKIN_GRACE_MINUTES);
  return { open, close };
};

/**
 * Resolves an accepted application's roster assignment, enforcing ownership and
 * a check-in-eligible shift state. Shared by check-in and check-out.
 * @param {string} userId
 * @param {string} applicationId
 */
const getCheckinContext = async (userId, applicationId) => {
  const worker = await getWorkerProfile(userId);

  const application = await applicationRepository.findOwnedApplication(applicationId, worker.id);
  if (!application) throw new AppError("Application not found", 404);
  if (application.status !== "accepted") {
    throw new AppError("Only an accepted application can be checked in", 409);
  }

  const assignment = await applicationRepository.findAssignmentContext(applicationId, worker.id);
  if (!assignment) throw new AppError("No roster assignment found for this application", 409);
  if (CHECKIN_BLOCKED_SHIFT_STATUSES.includes(assignment.shifts.status)) {
    throw new AppError(`Cannot check in to a '${assignment.shifts.status}' shift`, 409);
  }
  return assignment;
};

/**
 * Worker checks in to an accepted shift. Verifies presence by GPS geofence or a
 * shift QR token (manual = trusted timestamp, no presence proof).
 * @param {string} userId
 * @param {string} applicationId
 * @param {{ method: "gps"|"qr"|"manual", coordinates?: { latitude: number, longitude: number }, qr_token?: string }} data
 */
export const checkIn = async (userId, applicationId, { method, coordinates, qr_token }) => {
  const assignment = await getCheckinContext(userId, applicationId);
  if (assignment.checked_in_at) throw new AppError("You have already checked in", 409);

  const shift = assignment.shifts;
  const now = new Date();
  const { open, close } = checkinWindow(shift);
  if (now < open || now > close) {
    throw new AppError("Check-in is only allowed within the shift's time window", 422);
  }

  if (method === "gps") {
    if (!coordinates) throw new AppError("coordinates are required for GPS check-in", 422);
    const within = await applicationRepository.isWithinShiftGeofence(
      shift.id, coordinates.latitude, coordinates.longitude, CHECKIN_RADIUS_METERS,
    );
    if (!within) {
      throw new AppError(`You must be within ${CHECKIN_RADIUS_METERS}m of the shift location`, 422);
    }
  } else if (method === "qr") {
    if (!qr_token) throw new AppError("qr_token is required for QR check-in", 422);
    if (qr_token !== shift.checkin_qr_token) throw new AppError("Invalid check-in QR code", 422);
  }

  const updated = await applicationRepository.setCheckIn(assignment.id, method);

  // Notify the owning business with a live "X/Y checked in" progress count.
  const checkedIn = await applicationRepository.countCheckedIn(shift.id);
  await createNotification({
    user_id: shift.business_profiles.user_id,
    type: "in_app",
    priority: "normal",
    title: "Worker checked in",
    body: `${checkedIn}/${shift.workers_needed} workers checked in for "${shift.title}".`,
    data: { kind: "checkin", shift_id: shift.id, checked_in: checkedIn, needed: shift.workers_needed },
  });

  logger.info(`Worker checked in | userId=${userId} app=${applicationId} method=${method}`);
  return updated;
};

/**
 * Worker checks out of a shift they previously checked into.
 * @param {string} userId
 * @param {string} applicationId
 */
export const checkOut = async (userId, applicationId) => {
  const assignment = await getCheckinContext(userId, applicationId);
  if (!assignment.checked_in_at) throw new AppError("You have not checked in yet", 409);
  if (assignment.checked_out_at) throw new AppError("You have already checked out", 409);

  const updated = await applicationRepository.setCheckOut(assignment.id);
  logger.info(`Worker checked out | userId=${userId} app=${applicationId}`);
  return updated;
};
