import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";
import { createNotification } from "../notification/notification.service.js";
import { setting } from "../../config/settings.js";
import { verifyCheckinCode } from "../../utils/qrToken.js";
import { buildRoadmap } from "../../utils/shiftRoadmap.js";
import { shiftInstant, shiftWindow } from "../../utils/shiftTime.js";
import { advanceShiftStatus } from "../business/business.service.js";
import { workerConfirmCheckout } from "../payment/handshake.service.js";
import * as applicationRepository from "./application.repository.js";
import * as notificationRepository from "../notification/notification.repository.js";

// Shift states that accept new applications. Mid-lifecycle states stay
// applyable while capacity remains (a business may need to fill a spot after
// hiring started or even mid-shift); the capacity check below rejects full ones.
const APPLYABLE_SHIFT_STATUSES = [
  "published", "applications_open", "worker_selected", "worker_confirmed", "checked_in", "active",
];
// Application states a worker is allowed to withdraw from
const WITHDRAWABLE_STATUSES = ["pending", "shortlisted"];
// Shift states where check-in/out is no longer permitted.
const CHECKIN_BLOCKED_SHIFT_STATUSES = ["cancelled", "closed"];
// Shift states that mean the work is over (used to derive "completed" activity).
const SHIFT_DONE_STATUSES = ["completed", "payment_pending", "paid", "closed"];

/**
 * Derives the activity-tab presentation of an application: a single status the
 * worker understands (blends application + shift state), a contextual message,
 * and the next action they can take. See the Activity screen (screen 11).
 * @param {object} application application row including `shifts` + `worker_assignments`
 * @returns {{ activity_status: string, message: string|null, next_action: string|null }}
 */
const deriveActivity = (application) => {
  const shiftStatus = application.shifts?.status;
  const assignment = application.worker_assignments?.[0] ?? null;

  if (application.status === "withdrawn") return { activity_status: "withdrawn", message: "You withdrew from this shift.", next_action: null };
  if (application.status === "rejected") return { activity_status: "not_selected", message: "Not selected this time.", next_action: null };
  if (shiftStatus === "cancelled") return { activity_status: "cancelled", message: "This shift was cancelled.", next_action: null };
  if (application.status === "pending") return { activity_status: "pending", message: "Application under review.", next_action: null };
  if (application.status === "shortlisted") return { activity_status: "shortlisted", message: "You've been shortlisted.", next_action: null };

  // Hired: position within the run, driven by the completion handshake.
  switch (assignment?.completion_status) {
    case "disputed":
      return { activity_status: "disputed", message: "Payment is on hold while a dispute is reviewed.", next_action: null };
    case "no_show":
      return { activity_status: "no_show", message: "You were marked absent for this shift. Raise a dispute if this is wrong.", next_action: "raise_dispute" };
    case "confirmed":
    case "resolved": {
      const paid = assignment.paid_amount != null && Number(assignment.paid_amount) > 0;
      return {
        activity_status: "completed",
        message: paid ? `Shift completed — ৳${assignment.paid_amount} paid to your wallet.` : "Shift resolved — no payment was issued.",
        next_action: null,
      };
    }
    case "business_done":
      return { activity_status: "confirm_needed", message: "The business checked you out. Confirm to release your payment, or raise a dispute.", next_action: "confirm_checkout" };
    case "worker_done":
      return { activity_status: "awaiting_confirmation", message: "Checked out — waiting for the business to confirm your payment.", next_action: null };
    default:
      break;
  }
  if (assignment?.checked_out_at || SHIFT_DONE_STATUSES.includes(shiftStatus)) {
    return { activity_status: "completed", message: "Shift completed.", next_action: null };
  }
  if (assignment?.checked_in_at) {
    return { activity_status: "in_progress", message: "You're checked in — enjoy your shift.", next_action: "check_out" };
  }
  return { activity_status: "upcoming", message: "You got this shift! Get there on time for check-in.", next_action: "check_in" };
};

/**
 * Shapes an application row into an activity-tab item (derived status, message,
 * next action, and the shift's status roadmap). Drops the raw assignment array.
 * @param {object} application
 */
const toActivityItem = (application) => {
  const { worker_assignments, ...rest } = application;
  return {
    ...rest,
    ...deriveActivity(application),
    roadmap: buildRoadmap(application.shifts?.status),
  };
};

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
  // Self-dealing guard: one user can hold both a worker and a business profile
  // (same identity — phone). Block applying to a shift your own business posted.
  if (shift.business_profiles?.user_id === userId) {
    throw new AppError("You can't apply to a shift posted by your own business account", 403);
  }
  if (!APPLYABLE_SHIFT_STATUSES.includes(shift.status)) {
    throw new AppError("This shift is not accepting applications", 409);
  }
  // Time gate is the shift's actual end instant, not the calendar day — a shift
  // running until tonight stays applyable all day.
  if (shiftWindow(shift).end <= new Date()) {
    throw new AppError("This shift has already ended", 409);
  }

  const accepted = await applicationRepository.countAccepted(shift_id);
  if (accepted >= shift.workers_needed) throw new AppError("This shift is already full", 409);

  const existing = await applicationRepository.findApplication(shift_id, worker.id);
  if (existing) {
    // Withdrawal is terminal — a withdrawn worker cannot re-apply to the same shift.
    if (existing.status === "withdrawn") {
      throw new AppError("You have withdrawn from this shift and cannot apply again", 409);
    }
    throw new AppError("You have already applied to this shift", 409);
  }

  const application = await applicationRepository.createApplication({
    shift_id,
    worker_profile_id: worker.id,
    note,
  });

  // Notify the hiring business in real time (createNotification pushes
  // `notification:new` over Socket.IO).
  await createNotification({
    user_id: shift.business_profiles.user_id,
    type: "in_app",
    priority: "high",
    title: "New applicant",
    body: `${worker.full_name ?? "A worker"} applied to "${shift.title}".`,
    data: { kind: "new_applicant", shift_id: shift.id, application_id: application.id },
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
    items: items.map(toActivityItem),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
};

/**
 * Activity-tab header counts: applications grouped by status plus the worker's
 * unread notification badge (screen 11).
 * @param {string} userId
 */
export const getActivitySummary = async (userId) => {
  const worker = await applicationRepository.findWorkerProfile(userId);
  if (!worker) throw new AppError("Worker profile not found", 404);

  const [groups, unread] = await Promise.all([
    applicationRepository.groupWorkerApplicationsByStatus(worker.id),
    notificationRepository.countUnread(userId),
  ]);

  const byStatus = Object.fromEntries(groups.map((g) => [g.status, g._count.status]));
  const total = groups.reduce((sum, g) => sum + g._count.status, 0);
  const active = (byStatus.pending ?? 0) + (byStatus.shortlisted ?? 0) + (byStatus.accepted ?? 0);

  return {
    applications: { total, active, by_status: byStatus },
    unread_notifications: unread,
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
  // Stored times are Bangladesh wall-clock — convert to real UTC instants so the
  // window lines up with `now` (see utils/shiftTime.js).
  const open = shiftInstant(shift_date, start_time);
  let close = shiftInstant(shift_date, end_time);
  if (close <= open) close = new Date(close.getTime() + 24 * 60 * 60 * 1000);
  open.setMinutes(open.getMinutes() - setting("CHECKIN_GRACE_MINUTES"));
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
 * Confirms the worker is physically inside the shift geofence. Required for both
 * GPS and QR check-ins so a relayed/shared QR code cannot be used off-site.
 * @param {{ id: string }} shift
 * @param {{ latitude: number, longitude: number, accuracy?: number }} coordinates
 */
const assertWithinGeofence = async (shift, coordinates) => {
  if (!coordinates) throw new AppError("coordinates are required to check in", 422);
  if (coordinates.accuracy != null && coordinates.accuracy > setting("CHECKIN_MAX_ACCURACY_METERS")) {
    throw new AppError(
      `Location accuracy is too low (±${Math.round(coordinates.accuracy)}m). Move to open sky and retry`,
      422,
    );
  }
  const radius = setting("CHECKIN_RADIUS_METERS");
  const within = await applicationRepository.isWithinShiftGeofence(
    shift.id, coordinates.latitude, coordinates.longitude, radius,
  );
  if (!within) {
    throw new AppError(`You must be within ${radius}m of the shift location`, 422);
  }
};

/**
 * Worker checks in to an accepted shift. Presence is always proven by the GPS
 * geofence; QR additionally requires the live rotating on-site code. `manual` is
 * not worker-selectable (business/admin override only).
 * @param {string} userId
 * @param {string} applicationId
 * @param {{ method: "gps"|"qr", coordinates?: { latitude: number, longitude: number, accuracy?: number }, qr_token?: string }} data
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

  // Geofence applies to every method; QR layers the live code on top.
  await assertWithinGeofence(shift, coordinates);
  if (method === "qr") {
    if (!qr_token) throw new AppError("qr_token is required for QR check-in", 422);
    if (!verifyCheckinCode(shift.checkin_qr_token, shift.id, qr_token)) {
      throw new AppError("Invalid or expired check-in QR code", 422);
    }
  }

  // Atomic stamp — a concurrent request that loses the race gets count 0.
  const stamped = await applicationRepository.setCheckIn(assignment.id, method, now);
  if (stamped === 0) throw new AppError("You have already checked in", 409);
  const updated = { id: assignment.id, checked_in_at: now, checkin_method: method };

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

  // Roadmap: first check-in marks the shift checked-in; the last one marks it live.
  const target = checkedIn >= shift.workers_needed ? "active" : "checked_in";
  await advanceShiftStatus(shift.id, target, userId);

  logger.info(`Worker checked in | userId=${userId} app=${applicationId} method=${method}`);
  return updated;
};

/**
 * Worker checks out of a shift they previously checked into. This is the
 * worker's half of the completion handshake: the assignment moves to
 * `worker_done` and the business gets a confirm window to approve or dispute —
 * past it the handshake auto-confirms and the worker is paid.
 * @param {string} userId
 * @param {string} applicationId
 */
export const checkOut = async (userId, applicationId) => {
  const assignment = await getCheckinContext(userId, applicationId);
  if (!assignment.checked_in_at) throw new AppError("You have not checked in yet", 409);
  if (assignment.checked_out_at) throw new AppError("You have already checked out", 409);
  if (assignment.completion_status !== "pending") {
    throw new AppError(`This assignment is already '${assignment.completion_status}'`, 409);
  }

  const autoConfirmHours = setting("HANDSHAKE_AUTO_CONFIRM_HOURS");
  const autoConfirmAt = new Date(Date.now() + autoConfirmHours * 60 * 60 * 1000);
  const updated = await applicationRepository.setCheckOut(assignment.id, userId, autoConfirmAt);

  // The business closes the handshake: confirm releases payment, dispute
  // freezes it, silence auto-confirms at the deadline.
  await createNotification({
    user_id: assignment.shifts.business_profiles.user_id,
    type: "in_app",
    priority: "high",
    title: "Worker checked out — confirm completion",
    body: `A worker checked out of "${assignment.shifts.title}". Confirm to release their payment, or raise a dispute. It auto-confirms in ${autoConfirmHours}h.`,
    data: { kind: "worker_checkout", shift_id: assignment.shift_id, assignment_id: assignment.id, auto_confirm_at: autoConfirmAt },
  });

  // Roadmap: once every checked-in worker has left and the shift window has
  // ended, the work is over — mark the shift completed (unlocks finalization).
  const [checkedIn, checkedOut] = await Promise.all([
    applicationRepository.countCheckedIn(assignment.shift_id),
    applicationRepository.countCheckedOut(assignment.shift_id),
  ]);
  const { close } = checkinWindow(assignment.shifts);
  if (checkedIn > 0 && checkedOut >= checkedIn && new Date() >= close) {
    await advanceShiftStatus(assignment.shift_id, "completed", userId);
  }

  logger.info(`Worker checked out | userId=${userId} app=${applicationId} autoConfirmAt=${autoConfirmAt.toISOString()}`);
  return updated;
};

/**
 * Worker confirms a business-stamped check-out — completes the handshake and
 * releases payment immediately. Thin wrapper over the handshake engine.
 * @param {string} userId
 * @param {string} applicationId
 */
export const confirmCheckout = (userId, applicationId) =>
  workerConfirmCheckout(userId, applicationId);
