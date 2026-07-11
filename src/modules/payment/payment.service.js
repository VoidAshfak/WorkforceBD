import { Prisma } from "../../prisma/index.js";
import { prisma } from "../../db/index.js";
import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";
import { createNotification } from "../notification/notification.service.js";
import { advanceShiftStatus } from "../business/business.service.js";
import { settleShiftAssignments, finalizeShiftIfSettled } from "./handshake.service.js";
import * as paymentRepository from "./payment.repository.js";

// Minimum a worker may withdraw in one payout request (BDT).
const MIN_PAYOUT = 50;
// Shift states a business may manually mark completed from (auto-completion on the
// last checkout may already have advanced it; this covers shifts still mid-run).
const COMPLETABLE_SHIFT_STATUSES = [
  "published",
  "applications_open",
  "worker_selected",
  "worker_confirmed",
  "checked_in",
  "active",
];

/* ============================================================
 * Helpers
 * ========================================================== */

/**
 * Masks an MFS/bank account number for worker-facing responses (17****5678).
 * @param {string} num
 */
const maskAccount = (num) => {
  if (!num || num.length <= 6) return num;
  return `${num.slice(0, 2)}${"*".repeat(num.length - 6)}${num.slice(-4)}`;
};

/** Hides the full account number on a payout DTO. @param {object} payout */
const toWorkerPayout = (payout) => ({ ...payout, account_number: maskAccount(payout.account_number) });

/* ============================================================
 * Wallet (worker — screen 13)
 * ========================================================== */

/**
 * Worker wallet snapshot: balance, lifetime totals, pending settlement, and
 * rolling stats. Creates the wallet on first access.
 * @param {string} userId
 */
export const getWallet = async (userId) => {
  const wallet = await paymentRepository.ensureWallet(userId);
  const workerProfileId = await paymentRepository.findWorkerProfileId(userId);

  const [pending, weekly, completed] = await Promise.all([
    workerProfileId ? paymentRepository.sumPendingSettlement(workerProfileId) : 0,
    paymentRepository.sumWeeklyEarnings(wallet.id),
    paymentRepository.countEarnings(wallet.id),
  ]);

  return {
    ...wallet,
    pending_settlement: pending,
    weekly_earnings: weekly,
    shifts_completed: completed,
  };
};

/**
 * Paginated wallet ledger (newest first).
 * @param {string} userId
 * @param {{ page?: number, limit?: number }} query
 */
export const listTransactions = async (userId, query) => {
  const wallet = await paymentRepository.ensureWallet(userId);
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    paymentRepository.findTransactions({ walletId: wallet.id, skip, take: limit }),
    paymentRepository.countTransactions(wallet.id),
  ]);

  return { items, pagination: { page, limit, total, total_pages: Math.ceil(total / limit) } };
};

/* ============================================================
 * Payouts (worker — screen 13/16)
 * ========================================================== */

/**
 * Requests a withdrawal. The amount is held immediately (debited from balance
 * and logged) so it cannot be double-spent; an admin later sends or refunds it.
 * @param {string} userId
 * @param {{ amount: number, method: string, account_number: string, account_name?: string }} data
 */
export const requestPayout = async (userId, data) => {
  const wallet = await paymentRepository.ensureWallet(userId);
  const amount = new Prisma.Decimal(data.amount);

  if (amount.lessThan(MIN_PAYOUT)) {
    throw new AppError(`Minimum payout is ৳${MIN_PAYOUT}`, 400);
  }
  if (amount.greaterThan(wallet.balance)) {
    throw new AppError("Payout amount exceeds your available balance", 400);
  }

  const newBalance = new Prisma.Decimal(wallet.balance).minus(amount);

  const payout = await prisma.$transaction(async (tx) => {
    await paymentRepository.updateWallet(wallet.id, { balance: newBalance, updated_by: userId }, tx);
    await paymentRepository.createTransaction({
      wallet_id: wallet.id,
      type: "debit",
      amount,
      balance_after: newBalance,
      description: "Payout requested",
      created_by: userId,
    }, tx);
    return paymentRepository.createPayout({
      wallet_id: wallet.id,
      user_id: userId,
      amount,
      method: data.method,
      account_number: data.account_number,
      account_name: data.account_name ?? null,
      created_by: userId,
    }, tx);
  });

  logger.info(`Payout requested | userId=${userId} payoutId=${payout.id} amount=${amount}`);
  return toWorkerPayout(payout);
};

/**
 * Worker's own payout requests, paginated.
 * @param {string} userId
 * @param {{ status?: string, page?: number, limit?: number }} query
 */
export const listPayouts = async (userId, query) => {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    paymentRepository.findPayoutsByUser({ userId, status: query.status, skip, take: limit }),
    paymentRepository.countPayoutsByUser({ userId, status: query.status }),
  ]);

  return {
    items: items.map(toWorkerPayout),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
};

/* ============================================================
 * Settlement (business — screen 16)
 * ========================================================== */

/**
 * Resolves an owned shift in an expected state, or throws.
 * @param {string} userId
 * @param {string} shiftId
 */
const getOwnedShiftOrThrow = async (userId, shiftId) => {
  const shift = await paymentRepository.findOwnedShiftForSettle(shiftId, userId);
  if (!shift) throw new AppError("Shift not found", 404);
  return shift;
};

/**
 * Marks a live shift completed — this unlocks worker payment.
 * @param {string} userId
 * @param {string} shiftId
 */
export const completeShift = async (userId, shiftId) => {
  const shift = await getOwnedShiftOrThrow(userId, shiftId);
  if (!COMPLETABLE_SHIFT_STATUSES.includes(shift.status)) {
    throw new AppError(`A '${shift.status}' shift cannot be completed`, 409);
  }

  const updated = await paymentRepository.updateShiftStatus(shiftId, {
    status: "completed",
    updated_by: userId,
  });
  logger.info(`Shift completed | userId=${userId} shiftId=${shiftId}`);
  return updated;
};

/**
 * Settles a completed shift — the business's "confirm everything" shortcut over
 * the completion handshake. Absent workers become no-shows, forgotten check-outs
 * are stamped, every open handshake is confirmed and paid the flat shift pay,
 * and each slot's escrow slice is released. Disputed assignments stay frozen for
 * the admin: the shift parks at `payment_pending` and closes automatically when
 * the last dispute is resolved. Idempotent per assignment.
 * @param {string} userId
 * @param {string} shiftId
 */
export const settleShift = async (userId, shiftId) => {
  const shift = await getOwnedShiftOrThrow(userId, shiftId);
  if (["paid", "closed"].includes(shift.status)) {
    throw new AppError("This shift is already settled", 409);
  }
  if (!["completed", "payment_pending"].includes(shift.status)) {
    throw new AppError("Complete the shift before settling payment", 409);
  }

  const summary = await settleShiftAssignments(shift, userId);
  if (summary.paid + summary.no_show + summary.disputed + summary.skipped === 0) {
    throw new AppError("No hired workers to settle for this shift", 400);
  }

  // Everything resolved → finalize (returns leftover escrow, closes the shift).
  // Open disputes → park at payment_pending until the admin rules.
  const finalized = await finalizeShiftIfSettled(shiftId, userId);
  if (!finalized && summary.disputed > 0) {
    await advanceShiftStatus(shiftId, "payment_pending", userId);
  }

  logger.info(
    `Shift settled | userId=${userId} shiftId=${shiftId} paid=${summary.paid} no_show=${summary.no_show} disputed=${summary.disputed} closed=${finalized}`,
  );
  return {
    shift_id: shiftId,
    workers_paid: summary.paid,
    no_show: summary.no_show,
    disputes_held: summary.disputed,
    already_settled: summary.skipped,
    amount_each: new Prisma.Decimal(shift.pay_amount),
    closed: finalized,
  };
};

/* ============================================================
 * Payout processing (admin)
 * ========================================================== */

/**
 * Paginated payout queue (default: pending).
 * @param {{ status?: string, page?: number, limit?: number }} query
 */
export const listPayoutQueue = async (query) => {
  const status = query.status ?? "pending";
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 10));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    paymentRepository.findPayoutQueue({ status, skip, take: limit }),
    paymentRepository.countPayoutQueue({ status }),
  ]);

  return { items, pagination: { page, limit, total, total_pages: Math.ceil(total / limit) } };
};

/**
 * Approves (marks sent) or rejects (refunds) a pending payout. The held amount
 * was already debited at request time: approval only finalizes total_withdrawn;
 * rejection credits the amount back. Notifies the worker.
 * @param {string} adminId
 * @param {string} payoutId
 * @param {{ decision: "approve"|"reject", failure_reason?: string }} data
 */
export const processPayout = async (adminId, payoutId, { decision, failure_reason }) => {
  const payout = await paymentRepository.findPayoutById(payoutId);
  if (!payout) throw new AppError("Payout request not found", 404);
  if (payout.status !== "pending") {
    throw new AppError(`This payout is already '${payout.status}'`, 409);
  }

  const amount = new Prisma.Decimal(payout.amount);
  const wallet = payout.wallets;

  let updated;
  if (decision === "approve") {
    updated = await prisma.$transaction(async (tx) => {
      const fresh = await paymentRepository.ensureWallet(payout.user_id, tx);
      await paymentRepository.updateWallet(wallet.id, {
        total_withdrawn: new Prisma.Decimal(fresh.total_withdrawn).plus(amount),
        updated_by: adminId,
      }, tx);
      return paymentRepository.updatePayout(payoutId, {
        status: "sent",
        processed_by: adminId,
        processed_at: new Date(),
        updated_by: adminId,
      }, tx);
    });
  } else {
    // Refund the held amount back to the wallet balance.
    updated = await prisma.$transaction(async (tx) => {
      const fresh = await paymentRepository.ensureWallet(payout.user_id, tx);
      const newBalance = new Prisma.Decimal(fresh.balance).plus(amount);
      await paymentRepository.updateWallet(wallet.id, { balance: newBalance, updated_by: adminId }, tx);
      await paymentRepository.createTransaction({
        wallet_id: wallet.id,
        type: "credit",
        amount,
        balance_after: newBalance,
        description: "Payout refund",
        created_by: adminId,
      }, tx);
      return paymentRepository.updatePayout(payoutId, {
        status: "failed",
        failure_reason: failure_reason ?? null,
        processed_by: adminId,
        processed_at: new Date(),
        updated_by: adminId,
      }, tx);
    });
  }

  const approved = decision === "approve";
  await createNotification({
    user_id: payout.user_id,
    type: "in_app",
    priority: "high",
    title: approved ? "Payout sent" : "Payout failed",
    body: approved
      ? `Your payout of ৳${amount} has been sent to your ${payout.method} account.`
      : `Your payout of ৳${amount} could not be processed and was refunded to your wallet.${failure_reason ? ` Reason: ${failure_reason}` : ""}`,
    data: { kind: "payout_decision", status: approved ? "sent" : "failed" },
  });

  logger.info(`Payout ${decision} | payoutId=${payoutId} adminId=${adminId}`);
  return toWorkerPayout(updated);
};
