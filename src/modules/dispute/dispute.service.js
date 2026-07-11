import { Prisma } from "../../prisma/index.js";
import { prisma } from "../../db/index.js";
import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";
import { createNotification } from "../notification/notification.service.js";
import * as paymentRepository from "../payment/payment.repository.js";
import { resolveDisputedAssignment } from "../payment/handshake.service.js";
import * as disputeRepository from "./dispute.repository.js";

// Handshake states a dispute may be raised from. `confirmed`/`resolved` are
// already paid (money moved — use a report instead); `disputed` is already frozen.
const DISPUTABLE_STATUSES = ["pending", "worker_done", "business_done", "no_show"];

/* ============================================================
 * Raise (worker or business)
 * ========================================================== */

/**
 * Raises a payment dispute on a shift assignment and freezes its handshake —
 * the auto-confirm timer stops and no payment moves until an admin rules.
 * Either party of the assignment may raise: the worker (e.g. wrongly marked
 * no-show / checked out) or the business (e.g. worker left early, misconduct).
 * @param {string} userId
 * @param {{ assignment_id: string, description: string }} data
 */
export const raiseDispute = async (userId, { assignment_id, description }) => {
  const assignment = await paymentRepository.findAssignmentWithContext(assignment_id);
  if (!assignment) throw new AppError("Assignment not found", 404);

  const workerUserId = assignment.worker_profiles.user_id;
  const businessUserId = assignment.shifts.business_profiles.user_id;

  let againstUser;
  if (userId === workerUserId) againstUser = businessUserId;
  else if (userId === businessUserId) againstUser = workerUserId;
  else throw new AppError("You are not a party to this assignment", 403);

  if (assignment.shifts.status === "cancelled") {
    throw new AppError("This shift was cancelled — its compensation is already settled", 409);
  }
  if (assignment.paid_at) {
    throw new AppError("Payment for this assignment is already settled — file a report instead", 409);
  }
  if (assignment.completion_status === "disputed") {
    throw new AppError("A dispute is already open for this assignment", 409);
  }
  if (!DISPUTABLE_STATUSES.includes(assignment.completion_status)) {
    throw new AppError(`A '${assignment.completion_status}' assignment cannot be disputed`, 409);
  }
  // Nothing to argue about before anyone was on site.
  if (!assignment.checked_in_at && assignment.completion_status !== "no_show") {
    throw new AppError("This worker has not checked in yet — mark a no-show or wait for the shift", 409);
  }
  const open = await disputeRepository.findOpenDisputeForAssignment(assignment_id);
  if (open) throw new AppError("A dispute is already open for this assignment", 409);

  // Freeze the handshake and file the dispute atomically. The freeze is a
  // claim (paid_at must still be null) so a concurrent confirm/sweep can't
  // pay while the dispute lands.
  const dispute = await prisma.$transaction(async (tx) => {
    const frozen = await paymentRepository.claimAssignmentPayment(assignment_id, DISPUTABLE_STATUSES, {
      completion_status: "disputed",
      updated_by: userId,
    }, tx);
    if (frozen === 0) {
      throw new AppError("This assignment was just processed — refresh and try again", 409);
    }
    return disputeRepository.createDispute({
      shift_id: assignment.shift_id,
      assignment_id,
      raised_by: userId,
      against_user: againstUser,
      description,
      created_by: userId,
    }, tx);
  });

  // Both the counterparty and the admin queue hear about it.
  await createNotification({
    user_id: againstUser,
    type: "in_app",
    priority: "high",
    title: "Dispute raised",
    body: `A dispute was raised on "${assignment.shifts.title}". Payment for this assignment is on hold until an admin resolves it.`,
    data: { kind: "dispute_raised", dispute_id: dispute.id, shift_id: assignment.shift_id, assignment_id },
  });
  const adminIds = await disputeRepository.findAdminUserIds();
  await Promise.all(adminIds.map((adminId) =>
    createNotification({
      user_id: adminId,
      type: "in_app",
      priority: "high",
      title: "New dispute to resolve",
      body: `A dispute was raised on "${assignment.shifts.title}" (assignment payment frozen).`,
      data: { kind: "dispute_open", dispute_id: dispute.id, shift_id: assignment.shift_id },
    })));

  logger.info(`Dispute raised | userId=${userId} dispute=${dispute.id} assignment=${assignment_id}`);
  return dispute;
};

/**
 * Disputes the user is a party to (raised or against), paginated.
 * @param {string} userId
 * @param {{ status?: string, page?: number, limit?: number }} query
 */
export const listMyDisputes = async (userId, query) => {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 10));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    disputeRepository.findUserDisputes({ userId, status: query.status, skip, take: limit }),
    disputeRepository.countUserDisputes({ userId, status: query.status }),
  ]);

  return { items, pagination: { page, limit, total, total_pages: Math.ceil(total / limit) } };
};

/* ============================================================
 * Resolve (admin)
 * ========================================================== */

/**
 * Paginated dispute queue for the admin (default: open, oldest first).
 * @param {{ status?: string, page?: number, limit?: number }} query
 */
export const listDisputeQueue = async (query) => {
  const status = query.status ?? "open";
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 10));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    disputeRepository.findDisputeQueue({ status, skip, take: limit }),
    disputeRepository.countDisputeQueue({ status }),
  ]);

  return { items, pagination: { page, limit, total, total_pages: Math.ceil(total / limit) } };
};

/**
 * Admin ruling on a dispute. `pay_full` pays the shift's flat pay, `pay_partial`
 * pays the given amount (e.g. worker left early), `deny` pays nothing — in every
 * case the escrow slice is settled accordingly and the assignment unfreezes to
 * `resolved`. A resolution note is mandatory (both parties see the reasoning).
 * @param {string} adminId
 * @param {string} disputeId
 * @param {{ decision: "pay_full"|"pay_partial"|"deny", amount?: number, resolution_note: string }} data
 */
export const resolveDispute = async (adminId, disputeId, { decision, amount, resolution_note }) => {
  const dispute = await disputeRepository.findDisputeById(disputeId);
  if (!dispute) throw new AppError("Dispute not found", 404);
  if (!["open", "under_review"].includes(dispute.status)) {
    throw new AppError(`This dispute is already '${dispute.status}'`, 409);
  }
  if (!dispute.assignment_id) throw new AppError("This dispute is not tied to a shift assignment", 409);

  const assignment = await paymentRepository.findAssignmentWithContext(dispute.assignment_id);
  if (!assignment) throw new AppError("Assignment no longer exists", 409);
  if (assignment.completion_status !== "disputed") {
    throw new AppError(`The assignment is '${assignment.completion_status}', not frozen by this dispute`, 409);
  }

  const payFull = new Prisma.Decimal(assignment.shifts.pay_amount);
  let ruled;
  if (decision === "pay_full") ruled = payFull;
  else if (decision === "deny") ruled = new Prisma.Decimal(0);
  else {
    ruled = new Prisma.Decimal(amount);
    if (ruled.lessThanOrEqualTo(0) || ruled.greaterThanOrEqualTo(payFull)) {
      throw new AppError(`A partial amount must be between 0 and the shift pay (৳${payFull})`, 400);
    }
  }

  const executed = await resolveDisputedAssignment(assignment, ruled, adminId);
  if (!executed) throw new AppError("The assignment was already processed — refresh the dispute", 409);

  const updated = await disputeRepository.updateDispute(disputeId, {
    status: "resolved",
    decision,
    resolved_amount: ruled,
    resolved_by: adminId,
    resolution_note,
    updated_by: adminId,
  });

  const workerUserId = assignment.worker_profiles.user_id;
  const businessUserId = assignment.shifts.business_profiles.user_id;
  const title = assignment.shifts.title;
  const workerBody = ruled.greaterThan(0)
    ? `The dispute on "${title}" was resolved — ৳${ruled} has been credited to your wallet. Note: ${resolution_note}`
    : `The dispute on "${title}" was resolved with no payment. Note: ${resolution_note}`;
  const businessBody = ruled.greaterThan(0)
    ? `The dispute on "${title}" was resolved — ৳${ruled} was paid to the worker. Note: ${resolution_note}`
    : `The dispute on "${title}" was resolved in your favour — no payment was made. Note: ${resolution_note}`;

  await Promise.all([
    createNotification({
      user_id: workerUserId, type: "in_app", priority: "high",
      title: "Dispute resolved", body: workerBody,
      data: { kind: "dispute_resolved", dispute_id: disputeId, decision, amount: String(ruled) },
    }),
    createNotification({
      user_id: businessUserId, type: "in_app", priority: "high",
      title: "Dispute resolved", body: businessBody,
      data: { kind: "dispute_resolved", dispute_id: disputeId, decision, amount: String(ruled) },
    }),
  ]);

  logger.info(`Dispute resolved | adminId=${adminId} dispute=${disputeId} decision=${decision} amount=${ruled}`);
  return updated;
};
