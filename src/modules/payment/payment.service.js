import { Prisma } from "../../prisma/index.js";
import { prisma } from "../../db/index.js";
import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";
import { createNotification } from "../notification/notification.service.js";
import { releaseShiftEscrow } from "../business/business.service.js";
import * as paymentRepository from "./payment.repository.js";

// Minimum a worker may withdraw in one payout request (BDT).
const MIN_PAYOUT = 50;
// Shift states money operations may act on.
const COMPLETABLE_SHIFT_STATUSES = ["published", "applications_open"];

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
 * Settles a completed shift: pays every hired worker the flat shift pay, logs
 * the ledger entries atomically, then flips the shift to 'paid'. One-shot — a
 * second call is rejected by the status guard. Workers are notified in real time.
 * @param {string} userId
 * @param {string} shiftId
 */
export const settleShift = async (userId, shiftId) => {
  const shift = await getOwnedShiftOrThrow(userId, shiftId);
  if (shift.status === "paid") throw new AppError("This shift is already settled", 409);
  if (shift.status !== "completed") throw new AppError("Complete the shift before settling payment", 409);

  const accepted = await paymentRepository.findAcceptedApplications(shiftId);
  if (accepted.length === 0) throw new AppError("No hired workers to pay for this shift", 400);

  // Pay only workers who actually checked in; the rest are marked no_show.
  const attended = accepted.filter((app) => app.worker_assignments[0]?.checked_in_at);
  const noShow = accepted.filter((app) => !app.worker_assignments[0]?.checked_in_at);

  const payEach = new Prisma.Decimal(shift.pay_amount);

  // Credit attended workers, flag absentees, and close the shift in one transaction.
  await prisma.$transaction(async (tx) => {
    // Claim the shift first — a concurrent settle that loses this race gets 0 and aborts.
    const claimed = await paymentRepository.claimShiftForSettlement(shiftId, userId, tx);
    if (claimed === 0) throw new AppError("This shift is already settled", 409);

    await paymentRepository.markNoShow(noShow.map((app) => app.id), tx);

    for (const app of attended) {
      const workerUserId = app.worker_profiles.user_id;
      const wallet = await paymentRepository.ensureWallet(workerUserId, tx);
      const newBalance = new Prisma.Decimal(wallet.balance).plus(payEach);
      const newEarned = new Prisma.Decimal(wallet.total_earned).plus(payEach);

      await paymentRepository.updateWallet(wallet.id, {
        balance: newBalance,
        total_earned: newEarned,
        updated_by: userId,
      }, tx);
      await paymentRepository.createTransaction({
        wallet_id: wallet.id,
        shift_id: shiftId,
        type: "credit",
        amount: payEach,
        balance_after: newBalance,
        description: `Earnings: "${shift.title}"`,
        created_by: userId,
      }, tx);
    }

    // Release the business escrow: paid amount becomes spend, unspent (no-shows /
    // unfilled slots) returns to the business wallet's spendable balance.
    await releaseShiftEscrow(tx, shift, payEach.times(attended.length), userId);
  });

  // Notify paid workers after commit so a delivery failure can't roll back payment.
  await Promise.all(
    attended.map((app) =>
      createNotification({
        user_id: app.worker_profiles.user_id,
        type: "in_app",
        priority: "high",
        title: "Payment received!",
        body: `৳${payEach} for "${shift.title}" has been credited to your wallet.`,
        data: { kind: "payment_received", shift_id: shiftId },
      })
    )
  );

  logger.info(
    `Shift settled | userId=${userId} shiftId=${shiftId} paid=${attended.length} no_show=${noShow.length} each=${payEach}`,
  );
  return {
    shift_id: shiftId,
    workers_paid: attended.length,
    no_show: noShow.length,
    amount_each: payEach,
    total_paid: payEach.times(attended.length),
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
