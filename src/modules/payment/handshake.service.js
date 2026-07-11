import { Prisma } from "../../prisma/index.js";
import { prisma } from "../../db/index.js";
import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";
import { HANDSHAKE_AUTO_CONFIRM_HOURS, PLATFORM_FEE_PERCENT } from "../../constants.js";
import { shiftWindow } from "../../utils/shiftTime.js";
import { createNotification } from "../notification/notification.service.js";
import {
  advanceShiftStatus,
  releaseEscrowSliceTx,
  finalizeShiftEscrowTx,
  chargeBusinessWalletTx,
  refundShiftEscrow,
} from "../business/business.service.js";
import * as businessRepository from "../business/business.repository.js";
import * as paymentRepository from "./payment.repository.js";

// Completion-handshake engine. A shift assignment completes through a two-sided
// handshake: one side stamps the check-out (worker_done / business_done), the
// other confirms — or the confirm window lapses and the sweeper auto-confirms.
// The moment a handshake completes the worker is paid from the shift's escrow,
// one slice at a time. A dispute freezes the slice until an admin rules.

/** Confirm-window deadline starting now. */
const autoConfirmDeadline = () =>
  new Date(Date.now() + HANDSHAKE_AUTO_CONFIRM_HOURS * 60 * 60 * 1000);

/* ============================================================
 * Core payment (one assignment = one escrow slice)
 * ========================================================== */

/**
 * Claims an assignment and pays the worker inside one transaction.
 * `fromStatuses` guards the claim: a concurrent pay/settle/sweep losing the race
 * updates 0 rows and the whole transaction aborts, so money can never move twice.
 * @param {object} assignment row incl. shifts + worker_profiles + applications context
 * @param {{ fromStatuses: string[], completion: string, amount: Prisma.Decimal, actorId: string|null, confirmData?: object, description?: string, releaseSlice?: boolean }} opts
 * @returns {Promise<boolean>} false when the claim was lost (already processed)
 */
const payAssignment = async (assignment, {
  fromStatuses, completion, amount, actorId, confirmData = {}, description, releaseSlice = true,
}) => {
  const shift = assignment.shifts;
  const workerUserId = assignment.worker_profiles.user_id;
  const amt = new Prisma.Decimal(amount);

  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await paymentRepository.claimAssignmentPayment(assignment.id, fromStatuses, {
        completion_status: completion,
        paid_amount: amt,
        paid_at: new Date(),
        payment_status: amt.greaterThan(0) ? "received" : "failed",
        updated_by: actorId,
        ...confirmData,
      }, tx);
      if (claimed === 0) throw new AppError("This assignment was already processed", 409);

      if (amt.greaterThan(0)) {
        const wallet = await paymentRepository.ensureWallet(workerUserId, tx);
        const newBalance = new Prisma.Decimal(wallet.balance).plus(amt);
        await paymentRepository.updateWallet(wallet.id, {
          balance: newBalance,
          total_earned: new Prisma.Decimal(wallet.total_earned).plus(amt),
          updated_by: actorId,
        }, tx);
        await paymentRepository.createTransaction({
          wallet_id: wallet.id,
          shift_id: shift.id,
          assignment_id: assignment.id,
          type: "credit",
          amount: amt,
          balance_after: newBalance,
          description: description ?? `Earnings: "${shift.title}"`,
          created_by: actorId,
        }, tx);
        await paymentRepository.incrementWorkerCounter(assignment.worker_profile_id, "completed_shift_count", tx);
      }

      if (releaseSlice) {
        await releaseEscrowSliceTx(tx, shift, amt, actorId);
      } else if (amt.greaterThan(0)) {
        // Slice already refunded earlier (overturned no-show) — claw the ruling
        // amount plus its platform fee back from the business wallet's balance.
        await chargeBusinessWalletTx(tx, shift.business_profile_id, actorId, amt, {
          shiftId: shift.id, description: `Dispute ruling payout: "${shift.title}"`,
        });
        const fee = amt.times(PLATFORM_FEE_PERCENT).dividedBy(100).toDecimalPlaces(2);
        await chargeBusinessWalletTx(tx, shift.business_profile_id, actorId, fee, {
          shiftId: shift.id, description: `Platform fee (${PLATFORM_FEE_PERCENT}%): "${shift.title}"`,
        });
      }
    });
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 409) return false;
    throw err;
  }

  logger.info(`Assignment paid | assignment=${assignment.id} shift=${shift.id} amount=${amt} completion=${completion}`);
  return true;
};

/**
 * Completes a handshake at full pay and notifies the worker (and, for
 * auto-confirms, the business). Returns false if the claim was lost.
 * @param {object} assignment context row
 * @param {{ fromStatuses: string[], actorId: string|null, confirmData?: object, auto?: boolean }} opts
 */
const completeHandshake = async (assignment, { fromStatuses, actorId, confirmData = {}, auto = false }) => {
  const shift = assignment.shifts;
  const amount = new Prisma.Decimal(shift.pay_amount);

  const paid = await payAssignment(assignment, {
    fromStatuses, completion: "confirmed", amount, actorId, confirmData,
  });
  if (!paid) return false;

  // `rate_prompt` nudges the client to offer the post-shift rating flow.
  await createNotification({
    user_id: assignment.worker_profiles.user_id,
    type: "in_app",
    priority: "high",
    title: "Payment received!",
    body: `৳${amount} for "${shift.title}" has been credited to your wallet. Rate your experience with the business!`,
    data: { kind: "payment_received", shift_id: shift.id, assignment_id: assignment.id, rate_prompt: true },
  });
  if (auto) {
    await createNotification({
      user_id: shift.business_profiles.user_id,
      type: "in_app",
      priority: "normal",
      title: "Shift completion auto-confirmed",
      body: `The confirm window for ${assignment.worker_profiles.full_name ?? "a worker"} on "${shift.title}" lapsed — the handshake was auto-confirmed and ৳${amount} was paid.`,
      data: { kind: "handshake_auto_confirmed", shift_id: shift.id, assignment_id: assignment.id, rate_prompt: true },
    });
  } else {
    await createNotification({
      user_id: shift.business_profiles.user_id,
      type: "in_app",
      priority: "low",
      title: "Rate your worker",
      body: `"${shift.title}" is settled for ${assignment.worker_profiles.full_name ?? "a worker"}. Rate how it went — ratings drive matching quality.`,
      data: { kind: "rate_prompt", shift_id: shift.id, assignment_id: assignment.id, rate_prompt: true },
    });
  }
  return true;
};

/* ============================================================
 * Finalization (last handshake resolved → close the shift)
 * ========================================================== */

/**
 * Closes a shift once every assignment's handshake is resolved: returns whatever
 * escrow is still held (unfilled slots / denied slices already returned) and
 * advances the shift to `closed`. No-op while anything is unresolved, the shift
 * is still running, or it was cancelled.
 * @param {string} shiftId
 * @param {string|null} actorId
 * @returns {Promise<boolean>} whether the shift was finalized
 */
export const finalizeShiftIfSettled = async (shiftId, actorId = null) => {
  const unresolved = await paymentRepository.countUnresolvedAssignments(shiftId);
  if (unresolved > 0) return false;

  const shift = await paymentRepository.findShiftForFinalize(shiftId);
  if (!shift) return false;
  if (!["completed", "payment_pending", "paid"].includes(shift.status)) return false;

  await prisma.$transaction(async (tx) => {
    // Re-read inside the transaction — a concurrent finalize flips escrow_status
    // first and the second pass becomes a no-op inside finalizeShiftEscrowTx.
    const fresh = await paymentRepository.findShiftForFinalize(shiftId, tx);
    await finalizeShiftEscrowTx(tx, fresh, actorId);
    await advanceShiftStatus(shiftId, "closed", actorId, tx);
  });
  logger.info(`Shift finalized | shiftId=${shiftId}`);
  return true;
};

/* ============================================================
 * Worker side
 * ========================================================== */

/**
 * Worker confirms a business-stamped check-out (business_done → confirmed) —
 * the worker's half of the handshake. Pays immediately.
 * @param {string} userId
 * @param {string} applicationId
 */
export const workerConfirmCheckout = async (userId, applicationId) => {
  const workerProfileId = await paymentRepository.findWorkerProfileId(userId);
  if (!workerProfileId) throw new AppError("Worker profile not found", 404);

  const assignment = await paymentRepository.findAssignmentForWorker(applicationId, workerProfileId);
  if (!assignment) throw new AppError("No roster assignment found for this application", 404);
  if (assignment.completion_status === "disputed") {
    throw new AppError("This shift is under dispute — an admin will resolve it", 409);
  }
  if (assignment.completion_status !== "business_done") {
    throw new AppError("There is no business check-out waiting for your confirmation", 409);
  }

  await completeHandshake(assignment, {
    fromStatuses: ["business_done"],
    actorId: userId,
    confirmData: { worker_confirmed_at: new Date() },
  });
  await createNotification({
    user_id: assignment.shifts.business_profiles.user_id,
    type: "in_app",
    priority: "normal",
    title: "Worker confirmed completion",
    body: `${assignment.worker_profiles.full_name ?? "A worker"} confirmed the check-out for "${assignment.shifts.title}". Payment has been released.`,
    data: { kind: "handshake_confirmed", shift_id: assignment.shift_id, assignment_id: assignment.id },
  });
  await finalizeShiftIfSettled(assignment.shift_id, userId);

  logger.info(`Worker confirmed checkout | userId=${userId} assignment=${assignment.id}`);
  return paymentRepository.findAssignmentWithContext(assignment.id);
};

/* ============================================================
 * Business side
 * ========================================================== */

/** Resolves the caller's business profile or 404s. @param {string} userId */
const getBusinessProfile = async (userId) => {
  const profile = await businessRepository.findProfileSummary(userId);
  if (!profile) throw new AppError("Create your business profile first", 404);
  return profile;
};

/**
 * Resolves an assignment on an owned shift or 404s.
 * @param {string} userId
 * @param {string} assignmentId
 */
const getOwnedAssignment = async (userId, assignmentId) => {
  const profile = await getBusinessProfile(userId);
  const assignment = await paymentRepository.findAssignmentForBusiness(assignmentId, profile.id);
  if (!assignment) throw new AppError("Assignment not found", 404);
  if (assignment.shifts.status === "cancelled") {
    throw new AppError("This shift was cancelled", 409);
  }
  return assignment;
};

/**
 * Business stamps a check-out for a worker who forgot (or left early). Opens the
 * worker's confirm window: the worker confirms or disputes, or the handshake
 * auto-confirms after the window lapses. No money moves yet.
 * @param {string} userId
 * @param {string} assignmentId
 */
export const businessCheckoutWorker = async (userId, assignmentId) => {
  const assignment = await getOwnedAssignment(userId, assignmentId);
  if (!assignment.checked_in_at) throw new AppError("This worker never checked in", 409);
  if (assignment.checked_out_at) throw new AppError("This worker has already checked out", 409);
  if (assignment.completion_status !== "pending") {
    throw new AppError(`This assignment is already '${assignment.completion_status}'`, 409);
  }

  const deadline = autoConfirmDeadline();
  const updated = await paymentRepository.updateAssignment(assignment.id, {
    checked_out_at: new Date(),
    checkout_by: userId,
    completion_status: "business_done",
    business_confirmed_at: new Date(),
    auto_confirm_at: deadline,
    updated_by: userId,
  });

  await createNotification({
    user_id: assignment.worker_profiles.user_id,
    type: "in_app",
    priority: "high",
    title: "Business checked you out",
    body: `"${assignment.shifts.title}" marked you checked out. Confirm to release your payment, or raise a dispute if something is wrong. It auto-confirms in ${HANDSHAKE_AUTO_CONFIRM_HOURS}h.`,
    data: { kind: "business_checkout", shift_id: assignment.shift_id, assignment_id: assignment.id, application_id: assignment.application_id, auto_confirm_at: deadline },
  });

  logger.info(`Business checked worker out | userId=${userId} assignment=${assignmentId}`);
  return updated;
};

/**
 * Business confirms a worker's check-out (worker_done → confirmed) — the
 * business's half of the handshake. Pays the worker immediately.
 * @param {string} userId
 * @param {string} assignmentId
 */
export const businessConfirmCheckout = async (userId, assignmentId) => {
  const assignment = await getOwnedAssignment(userId, assignmentId);
  if (assignment.completion_status === "disputed") {
    throw new AppError("This assignment is under dispute — an admin will resolve it", 409);
  }
  if (assignment.completion_status !== "worker_done") {
    throw new AppError("There is no worker check-out waiting for your confirmation", 409);
  }

  await completeHandshake(assignment, {
    fromStatuses: ["worker_done"],
    actorId: userId,
    confirmData: { business_confirmed_at: new Date() },
  });
  await finalizeShiftIfSettled(assignment.shift_id, userId);

  logger.info(`Business confirmed checkout | userId=${userId} assignment=${assignmentId}`);
  return paymentRepository.findAssignmentWithContext(assignmentId);
};

/**
 * Marks a hired worker who never arrived as a no-show: application + assignment
 * flip to no_show, the worker's counter goes up, and the slot's escrow slice
 * returns to the business wallet. The worker is notified and may dispute.
 * @param {object} assignment context row (completion must be claimable from `pending`)
 * @param {string|null} actorId
 * @returns {Promise<boolean>} false when the claim was lost
 */
export const markAssignmentNoShow = async (assignment, actorId) => {
  const shift = assignment.shifts;
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await paymentRepository.claimAssignmentPayment(assignment.id, ["pending"], {
        completion_status: "no_show",
        updated_by: actorId,
      }, tx);
      if (claimed === 0) throw new AppError("This assignment was already processed", 409);

      await tx.applications.update({
        where: { id: assignment.application_id },
        data: { status: "no_show", updated_by: actorId },
      });
      await paymentRepository.incrementWorkerCounter(assignment.worker_profile_id, "no_show_count", tx);
      await releaseEscrowSliceTx(tx, shift, 0, actorId);
    });
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 409) return false;
    throw err;
  }

  await createNotification({
    user_id: assignment.worker_profiles.user_id,
    type: "in_app",
    priority: "high",
    title: "Marked as no-show",
    body: `You were marked absent for "${shift.title}". If this is wrong, raise a dispute and an admin will review it.`,
    data: { kind: "no_show", shift_id: shift.id, assignment_id: assignment.id },
  });
  logger.info(`Assignment no-show | assignment=${assignment.id} shift=${shift.id}`);
  return true;
};

/**
 * Business marks a worker absent (endpoint wrapper). Only valid once the shift
 * has started and the worker has not checked in.
 * @param {string} userId
 * @param {string} assignmentId
 */
export const businessMarkNoShow = async (userId, assignmentId) => {
  const assignment = await getOwnedAssignment(userId, assignmentId);
  if (assignment.checked_in_at) throw new AppError("This worker has checked in — they are not a no-show", 409);
  if (assignment.completion_status !== "pending") {
    throw new AppError(`This assignment is already '${assignment.completion_status}'`, 409);
  }
  const { start } = shiftWindow(assignment.shifts);
  if (new Date() < start) throw new AppError("The shift has not started yet", 409);

  await markAssignmentNoShow(assignment, userId);
  await finalizeShiftIfSettled(assignment.shift_id, userId);
  return paymentRepository.findAssignmentWithContext(assignmentId);
};

/**
 * Business "settle everything" shortcut: walks every assignment on a shift and
 * closes whatever is still open — absentees become no-shows, forgotten
 * check-outs are stamped, and every open handshake is confirmed at full pay.
 * Disputed slices are left frozen for the admin. Used by shift settlement.
 * @param {{ id: string }} shift owned shift (ownership checked by the caller)
 * @param {string} actorId business user id
 * @returns {Promise<{ paid: number, no_show: number, disputed: number, skipped: number }>}
 */
export const settleShiftAssignments = async (shift, actorId) => {
  const assignments = await paymentRepository.findShiftAssignments(shift.id);
  const summary = { paid: 0, no_show: 0, disputed: 0, skipped: 0 };

  for (const a of assignments) {
    switch (a.completion_status) {
      case "pending":
        if (!a.checked_in_at) {
          (await markAssignmentNoShow(a, actorId)) ? summary.no_show += 1 : summary.skipped += 1;
        } else {
          // Stamp the forgotten check-out, then confirm — settling IS the
          // business's confirmation.
          await paymentRepository.updateAssignment(a.id, {
            checked_out_at: a.checked_out_at ?? new Date(),
            checkout_by: actorId,
            completion_status: "business_done",
            business_confirmed_at: new Date(),
            updated_by: actorId,
          });
          const paid = await completeHandshake({ ...a, completion_status: "business_done" }, {
            fromStatuses: ["business_done"], actorId,
          });
          paid ? summary.paid += 1 : summary.skipped += 1;
        }
        break;
      case "worker_done": {
        const paid = await completeHandshake(a, {
          fromStatuses: ["worker_done"], actorId,
          confirmData: { business_confirmed_at: new Date() },
        });
        paid ? summary.paid += 1 : summary.skipped += 1;
        break;
      }
      case "business_done": {
        // Worker's confirm window still open, but paying full pay early can
        // only benefit the worker — settle it.
        const paid = await completeHandshake(a, { fromStatuses: ["business_done"], actorId });
        paid ? summary.paid += 1 : summary.skipped += 1;
        break;
      }
      case "disputed":
        summary.disputed += 1;
        break;
      default:
        summary.skipped += 1; // confirmed / resolved / no_show — already settled
    }
  }
  return summary;
};

/* ============================================================
 * Dispute resolution hook (called by the dispute module)
 * ========================================================== */

/**
 * Executes an admin dispute ruling on a frozen assignment: pays the worker the
 * ruled amount (full / partial / zero) and settles the escrow slice. When the
 * slice was already refunded (overturned no-show) the amount is charged back to
 * the business wallet instead. Marks the assignment `resolved`.
 * @param {object} assignment context row (completion_status must be `disputed`)
 * @param {Prisma.Decimal|string|number} amount ruled payout (0 for deny)
 * @param {string} adminId
 * @returns {Promise<boolean>} false when the claim was lost
 */
export const resolveDisputedAssignment = async (assignment, amount, adminId) => {
  const amt = new Prisma.Decimal(amount);
  // A no_show application means the slot's escrow slice was already returned to
  // the business when the no-show was marked — any payout is a clawback.
  const sliceHeld = assignment.applications.status !== "no_show";

  const paid = await payAssignment(assignment, {
    fromStatuses: ["disputed"],
    completion: "resolved",
    amount: amt,
    actorId: adminId,
    releaseSlice: sliceHeld,
    description: `Dispute ruling: "${assignment.shifts.title}"`,
  });
  if (!paid) return false;

  // An overturned no-show restores the worker's record.
  if (!sliceHeld && amt.greaterThan(0)) {
    await prisma.applications.update({
      where: { id: assignment.application_id },
      data: { status: "accepted", updated_by: adminId },
    });
    await prisma.worker_profiles.update({
      where: { id: assignment.worker_profile_id },
      data: { no_show_count: { decrement: 1 } },
    });
  }

  await finalizeShiftIfSettled(assignment.shift_id, adminId);
  return true;
};

/* ============================================================
 * Sweeper (unsupervised path)
 * ========================================================== */

/**
 * Expires an ended shift that nobody was ever hired for: the post flips to
 * `cancelled` (claim-guarded) and the full escrow — nothing was earned against
 * it — returns to the business wallet. The business is notified.
 * @param {object} shift row from findExpiredUnhiredShifts
 * @returns {Promise<boolean>} whether this call expired it
 */
const expireUnhiredShift = async (shift) => {
  let claimed = false;
  await prisma.$transaction(async (tx) => {
    // Claim the status flip first — a concurrent cancel/approve loses cleanly.
    const { count } = await tx.shifts.updateMany({
      where: { id: shift.id, status: { in: paymentRepository.EXPIRABLE_SHIFT_STATUSES } },
      data: { status: "cancelled", cancellation_reason: "Expired — no workers were hired" },
    });
    if (count === 0) return;
    claimed = true;
    await refundShiftEscrow(shift, null, tx);
  });
  if (!claimed) return false;

  await createNotification({
    user_id: shift.business_profiles.user_id,
    type: "in_app",
    priority: "normal",
    title: "Shift expired",
    body: `"${shift.title}" ended without any workers hired. The post was closed and its escrow of ৳${shift.escrow_amount} was returned to your wallet.`,
    data: { kind: "shift_expired", shift_id: shift.id },
  });
  logger.info(`Shift expired (unhired) | shiftId=${shift.id} refunded=${shift.escrow_amount}`);
  return true;
};

/**
 * One sweep pass. Everything here is idempotent and claim-guarded, so overlapping
 * runs (or a restart mid-pass) are safe:
 * 0. Ended shifts nobody was hired for: expire (cancel + refund escrow).
 * 1. Ended shifts: auto-check-out workers who forgot (opens the business's
 *    confirm window) and mark never-arrived workers as no-shows; advance the
 *    shift to `completed`.
 * 2. Lapsed confirm windows: auto-confirm the handshake and pay the worker.
 * 3. Done shifts with everything resolved but escrow still held: finalize.
 * @returns {Promise<{ expired: number, auto_checkouts: number, no_shows: number, auto_confirms: number, finalized: number }>}
 */
export const sweepHandshakes = async () => {
  const now = new Date();
  const stats = { expired: 0, auto_checkouts: 0, no_shows: 0, auto_confirms: 0, finalized: 0 };

  // 0. Expire ended shifts with zero hires.
  const unhired = await paymentRepository.findExpiredUnhiredShifts(now);
  for (const shift of unhired) {
    if (now < shiftWindow(shift).end) continue; // still running / not started
    if (await expireUnhiredShift(shift)) stats.expired += 1;
  }

  // 1. Attendance on ended shifts.
  const liveShifts = await paymentRepository.findLiveShiftsForAttendanceSweep(now);
  for (const shift of liveShifts) {
    const { end } = shiftWindow(shift);
    if (now < end) continue; // still running

    for (const a of shift.worker_assignments) {
      // Re-shape to the context the engine expects (shift is the parent row here).
      const assignment = { ...a, shifts: shift };
      if (!a.checked_in_at) {
        if (await markAssignmentNoShow(assignment, null)) stats.no_shows += 1;
      } else if (!a.checked_out_at) {
        const deadline = autoConfirmDeadline();
        await paymentRepository.updateAssignment(a.id, {
          checked_out_at: end,
          completion_status: "worker_done",
          auto_confirm_at: deadline,
        });
        stats.auto_checkouts += 1;
        await createNotification({
          user_id: a.worker_profiles.user_id,
          type: "in_app",
          priority: "normal",
          title: "Checked out automatically",
          body: `"${shift.title}" ended — you were checked out automatically. Payment releases once the business confirms or in ${HANDSHAKE_AUTO_CONFIRM_HOURS}h.`,
          data: { kind: "auto_checkout", shift_id: shift.id, assignment_id: a.id },
        });
        await createNotification({
          user_id: shift.business_profiles.user_id,
          type: "in_app",
          priority: "normal",
          title: "Worker auto-checked out",
          body: `${a.worker_profiles.full_name ?? "A worker"} was auto-checked out of "${shift.title}". Confirm or dispute within ${HANDSHAKE_AUTO_CONFIRM_HOURS}h, or it auto-confirms.`,
          data: { kind: "auto_checkout", shift_id: shift.id, assignment_id: a.id },
        });
      }
    }
    // Every attendance record is stamped now — the work itself is over.
    await advanceShiftStatus(shift.id, "completed", null);
    if (await finalizeShiftIfSettled(shift.id)) stats.finalized += 1;
  }

  // 2. Lapsed confirm windows → auto-confirm + pay.
  const due = await paymentRepository.findDueHandshakes(now);
  for (const assignment of due) {
    // The assignment sat through its confirm window with no objection from
    // either side — the platform completes the handshake on their behalf.
    if (now >= shiftWindow(assignment.shifts).end) {
      await advanceShiftStatus(assignment.shift_id, "completed", null);
    }
    if (await completeHandshake(assignment, {
      fromStatuses: ["worker_done", "business_done"],
      actorId: null,
      auto: true,
    })) stats.auto_confirms += 1;
    if (await finalizeShiftIfSettled(assignment.shift_id)) stats.finalized += 1;
  }

  // 3. Restart safety net: done shifts whose inline finalize was missed.
  const awaiting = await paymentRepository.findShiftsAwaitingFinalize();
  for (const s of awaiting) {
    if (await finalizeShiftIfSettled(s.id)) stats.finalized += 1;
  }

  if (stats.expired || stats.auto_checkouts || stats.no_shows || stats.auto_confirms || stats.finalized) {
    logger.info(
      `Handshake sweep | expired=${stats.expired} auto_checkouts=${stats.auto_checkouts} no_shows=${stats.no_shows} auto_confirms=${stats.auto_confirms} finalized=${stats.finalized}`,
    );
  }
  return stats;
};
