import { prisma } from "../../db/index.js";

// Client-safe wallet columns.
const walletSelect = {
  id: true,
  balance: true,
  total_earned: true,
  total_withdrawn: true,
  currency: true,
};

// Client-safe payout columns.
const payoutSelect = {
  id: true,
  amount: true,
  method: true,
  account_number: true,
  account_name: true,
  status: true,
  failure_reason: true,
  processed_at: true,
  created_at: true,
};

/* ----------------------------- Wallet ------------------------------ */

/**
 * Returns the user's wallet, creating it on first access (one per user).
 * @param {string} userId
 * @param {import("@prisma/client").Prisma.TransactionClient} [client]
 */
export const ensureWallet = (userId, client = prisma) => {
  return client.wallets.upsert({
    where: { user_id: userId },
    update: {},
    create: { user_id: userId, created_by: userId },
    select: walletSelect,
  });
};

/** @param {string} userId */
export const findWallet = (userId) => {
  return prisma.wallets.findUnique({ where: { user_id: userId }, select: walletSelect });
};

/**
 * @param {string} walletId
 * @param {object} data
 * @param {import("@prisma/client").Prisma.TransactionClient} [client]
 */
export const updateWallet = (walletId, data, client = prisma) => {
  return client.wallets.update({ where: { id: walletId }, data, select: walletSelect });
};

/* --------------------------- Wallet stats -------------------------- */

/** Worker profile id for a user (applications are keyed by it). @param {string} userId */
export const findWorkerProfileId = async (userId) => {
  const profile = await prisma.worker_profiles.findUnique({
    where: { user_id: userId },
    select: { id: true },
  });
  return profile?.id ?? null;
};

/**
 * Flat pay still owed: accepted applications on completed (un-settled) shifts.
 * @param {string} workerProfileId
 * @returns {Promise<number>}
 */
export const sumPendingSettlement = async (workerProfileId) => {
  const rows = await prisma.applications.findMany({
    where: {
      worker_profile_id: workerProfileId,
      status: "accepted",
      deleted_at: null,
      shifts: { status: "completed", deleted_at: null },
    },
    select: { shifts: { select: { pay_amount: true } } },
  });
  return rows.reduce((sum, r) => sum + Number(r.shifts.pay_amount), 0);
};

/** Sum of earning credits in the last 7 days. @param {string} walletId */
export const sumWeeklyEarnings = async (walletId) => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const agg = await prisma.transactions.aggregate({
    where: { wallet_id: walletId, type: "credit", shift_id: { not: null }, created_at: { gte: since } },
    _sum: { amount: true },
  });
  return Number(agg._sum.amount ?? 0);
};

/** Number of shifts the worker has been paid for. @param {string} walletId */
export const countEarnings = (walletId) => {
  return prisma.transactions.count({
    where: { wallet_id: walletId, type: "credit", shift_id: { not: null } },
  });
};

/* -------------------------- Transactions --------------------------- */

/**
 * @param {object} data
 * @param {import("@prisma/client").Prisma.TransactionClient} [client]
 */
export const createTransaction = (data, client = prisma) => {
  return client.transactions.create({ data });
};

/** @param {{ walletId: string, skip: number, take: number }} opts */
export const findTransactions = ({ walletId, skip, take }) => {
  return prisma.transactions.findMany({
    where: { wallet_id: walletId, deleted_at: null },
    orderBy: { created_at: "desc" },
    skip,
    take,
    select: {
      id: true, type: true, amount: true, balance_after: true,
      description: true, shift_id: true, reference_id: true, created_at: true,
    },
  });
};

/** @param {string} walletId */
export const countTransactions = (walletId) => {
  return prisma.transactions.count({ where: { wallet_id: walletId, deleted_at: null } });
};

/* ---------------------------- Payouts ------------------------------ */

/**
 * @param {object} data
 * @param {import("@prisma/client").Prisma.TransactionClient} [client]
 */
export const createPayout = (data, client = prisma) => {
  return client.payout_requests.create({ data, select: payoutSelect });
};

/** @param {{ userId: string, status?: string, skip: number, take: number }} opts */
export const findPayoutsByUser = ({ userId, status, skip, take }) => {
  const where = { user_id: userId, deleted_at: null };
  if (status) where.status = status;
  return prisma.payout_requests.findMany({
    where,
    orderBy: { created_at: "desc" },
    skip,
    take,
    select: payoutSelect,
  });
};

/** @param {{ userId: string, status?: string }} opts */
export const countPayoutsByUser = ({ userId, status }) => {
  const where = { user_id: userId, deleted_at: null };
  if (status) where.status = status;
  return prisma.payout_requests.count({ where });
};

/* --------------------- Payouts (admin queue) ----------------------- */

const payoutQueueSelect = {
  id: true,
  amount: true,
  method: true,
  account_number: true,
  account_name: true,
  status: true,
  created_at: true,
  users_payout_requests_user_idTousers: { select: { id: true, phone: true } },
};

/** @param {{ status?: string, skip: number, take: number }} opts */
export const findPayoutQueue = ({ status, skip, take }) => {
  const where = { deleted_at: null };
  if (status) where.status = status;
  return prisma.payout_requests.findMany({
    where,
    orderBy: { created_at: "asc" }, // oldest waiting first
    skip,
    take,
    select: payoutQueueSelect,
  });
};

/** @param {{ status?: string }} opts */
export const countPayoutQueue = ({ status }) => {
  const where = { deleted_at: null };
  if (status) where.status = status;
  return prisma.payout_requests.count({ where });
};

/** @param {string} id */
export const findPayoutById = (id) => {
  return prisma.payout_requests.findFirst({
    where: { id, deleted_at: null },
    include: { wallets: { select: { id: true, balance: true } } },
  });
};

/**
 * @param {string} id
 * @param {object} data
 * @param {import("@prisma/client").Prisma.TransactionClient} [client]
 */
export const updatePayout = (id, data, client = prisma) => {
  return client.payout_requests.update({ where: { id }, data, select: payoutSelect });
};

/* --------------------------- Settlement ---------------------------- */

/**
 * A shift owned by the user's business, for settlement (ownership-scoped).
 * @param {string} shiftId
 * @param {string} userId
 */
export const findOwnedShiftForSettle = (shiftId, userId) => {
  return prisma.shifts.findFirst({
    where: { id: shiftId, deleted_at: null, business_profiles: { user_id: userId } },
    select: { id: true, status: true, title: true, pay_amount: true },
  });
};

/**
 * Accepted (hired) applications for a shift, with the worker's user id.
 * @param {string} shiftId
 */
export const findAcceptedApplications = (shiftId) => {
  return prisma.applications.findMany({
    where: { shift_id: shiftId, status: "accepted", deleted_at: null },
    select: { id: true, worker_profiles: { select: { user_id: true } } },
  });
};

/**
 * @param {string} shiftId
 * @param {object} data
 * @param {import("@prisma/client").Prisma.TransactionClient} [client]
 */
export const updateShiftStatus = (shiftId, data, client = prisma) => {
  return client.shifts.update({ where: { id: shiftId }, data, select: { id: true, status: true } });
};

/**
 * Atomically claims a completed shift for settlement (completed → paid). Returns
 * the number of rows flipped — 0 means a concurrent settle already won the race.
 * Run first inside the settlement transaction to serialize on the shift row.
 * @param {string} shiftId
 * @param {string} userId
 * @param {import("@prisma/client").Prisma.TransactionClient} client
 * @returns {Promise<number>}
 */
export const claimShiftForSettlement = async (shiftId, userId, client) => {
  const { count } = await client.shifts.updateMany({
    where: { id: shiftId, status: "completed" },
    data: { status: "paid", updated_by: userId },
  });
  return count;
};
