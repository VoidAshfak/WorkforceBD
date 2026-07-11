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
 * Flat pay still owed: attended assignments whose completion handshake has not
 * paid out yet (open, awaiting confirmation, or frozen by a dispute).
 * @param {string} workerProfileId
 * @returns {Promise<number>}
 */
export const sumPendingSettlement = async (workerProfileId) => {
  const rows = await prisma.worker_assignments.findMany({
    where: {
      worker_profile_id: workerProfileId,
      deleted_at: null,
      checked_in_at: { not: null },
      paid_at: null,
      completion_status: { in: ["pending", "worker_done", "business_done", "disputed"] },
      shifts: { deleted_at: null, status: { not: "cancelled" } },
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

/* --------------------------- Handshake ----------------------------- */

// Everything the handshake engine needs alongside an assignment row: the shift
// (money + timing + owner), the worker (wallet owner) and the application (status).
const assignmentContextInclude = {
  shifts: {
    select: {
      id: true, title: true, status: true, shift_date: true, start_time: true, end_time: true,
      pay_amount: true, workers_needed: true, business_profile_id: true,
      escrow_amount: true, escrow_status: true,
      business_profiles: { select: { user_id: true } },
    },
  },
  worker_profiles: { select: { id: true, user_id: true, full_name: true } },
  applications: { select: { id: true, status: true } },
};

/**
 * @param {string} assignmentId
 * @param {import("@prisma/client").Prisma.TransactionClient} [client]
 */
export const findAssignmentWithContext = (assignmentId, client = prisma) => {
  return client.worker_assignments.findFirst({
    where: { id: assignmentId, deleted_at: null },
    include: assignmentContextInclude,
  });
};

/**
 * Assignment scoped to the owning business (404 guard for business handshake ops).
 * @param {string} assignmentId
 * @param {string} businessProfileId
 */
export const findAssignmentForBusiness = (assignmentId, businessProfileId) => {
  return prisma.worker_assignments.findFirst({
    where: { id: assignmentId, deleted_at: null, shifts: { business_profile_id: businessProfileId } },
    include: assignmentContextInclude,
  });
};

/**
 * Assignment scoped to the owning worker, looked up by its application.
 * @param {string} applicationId
 * @param {string} workerProfileId
 */
export const findAssignmentForWorker = (applicationId, workerProfileId) => {
  return prisma.worker_assignments.findFirst({
    where: { application_id: applicationId, worker_profile_id: workerProfileId, deleted_at: null },
    include: assignmentContextInclude,
  });
};

/**
 * Atomically claims an assignment for payment: flips it out of `fromStatuses`
 * only if it has not been paid yet. Returns the number of rows updated — 0 means
 * a concurrent pay/settle/sweep won the race, or the state changed underneath.
 * @param {string} assignmentId
 * @param {string[]} fromStatuses completion states the claim is valid from
 * @param {object} data new payment/completion fields
 * @param {import("@prisma/client").Prisma.TransactionClient} [client]
 * @returns {Promise<number>}
 */
export const claimAssignmentPayment = async (assignmentId, fromStatuses, data, client = prisma) => {
  const { count } = await client.worker_assignments.updateMany({
    where: { id: assignmentId, paid_at: null, completion_status: { in: fromStatuses }, deleted_at: null },
    data,
  });
  return count;
};

/**
 * @param {string} assignmentId
 * @param {object} data
 * @param {import("@prisma/client").Prisma.TransactionClient} [client]
 */
export const updateAssignment = (assignmentId, data, client = prisma) => {
  return client.worker_assignments.update({ where: { id: assignmentId }, data });
};

/**
 * Assignments on a shift whose handshake is still open (blocks finalization).
 * @param {string} shiftId
 * @param {import("@prisma/client").Prisma.TransactionClient} [client]
 */
export const countUnresolvedAssignments = (shiftId, client = prisma) => {
  return client.worker_assignments.count({
    where: {
      shift_id: shiftId,
      deleted_at: null,
      completion_status: { in: ["pending", "worker_done", "business_done", "disputed"] },
    },
  });
};

/** All assignments on a shift with handshake context (settle loop). @param {string} shiftId */
export const findShiftAssignments = (shiftId) => {
  return prisma.worker_assignments.findMany({
    where: { shift_id: shiftId, deleted_at: null },
    include: assignmentContextInclude,
  });
};

/**
 * Handshakes whose confirm window has lapsed — the sweeper auto-confirms these.
 * @param {Date} now
 * @param {number} take
 */
export const findDueHandshakes = (now, take = 100) => {
  return prisma.worker_assignments.findMany({
    where: {
      deleted_at: null,
      paid_at: null,
      completion_status: { in: ["worker_done", "business_done"] },
      auto_confirm_at: { lte: now },
    },
    include: assignmentContextInclude,
    take,
  });
};

// Statuses a shift can be in while its roster still has open attendance.
const LIVE_SHIFT_STATUSES = [
  "published", "applications_open", "worker_selected", "worker_confirmed",
  "worker_arriving", "checked_in", "active",
];

/**
 * Live shifts dated today-or-earlier that have at least one hired worker. The
 * sweeper computes each shift's real end instant in JS (date + time columns are
 * wall-clock), closes open attendance on the truly-ended ones, and advances them
 * to `completed` (also un-sticks shifts whose roster resolved without a status
 * bump, e.g. everyone marked no-show mid-run).
 * @param {Date} maxDate latest shift_date to consider
 */
export const findLiveShiftsForAttendanceSweep = (maxDate) => {
  return prisma.shifts.findMany({
    where: {
      deleted_at: null,
      status: { in: LIVE_SHIFT_STATUSES },
      shift_date: { lte: maxDate },
      worker_assignments: { some: { deleted_at: null } },
    },
    select: {
      id: true, title: true, status: true, shift_date: true, start_time: true, end_time: true,
      pay_amount: true, workers_needed: true, business_profile_id: true,
      escrow_amount: true, escrow_status: true,
      business_profiles: { select: { user_id: true } },
      worker_assignments: {
        where: { deleted_at: null, completion_status: "pending" },
        include: { worker_profiles: { select: { id: true, user_id: true, full_name: true } }, applications: { select: { id: true, status: true } } },
      },
    },
    take: 100,
  });
};

// Pre-work statuses an unhired shift can expire from. `worker_selected`+
// implies hires exist; drafts hold no money and stay editable.
const EXPIRABLE_SHIFT_STATUSES = ["pending_approval", "published", "applications_open"];
export { EXPIRABLE_SHIFT_STATUSES };

/**
 * Dated shifts that nobody was ever hired for — candidates for auto-expiry
 * (cancel + full escrow refund). The sweeper end-checks each one in JS.
 * @param {Date} maxDate latest shift_date to consider
 */
export const findExpiredUnhiredShifts = (maxDate) => {
  return prisma.shifts.findMany({
    where: {
      deleted_at: null,
      status: { in: EXPIRABLE_SHIFT_STATUSES },
      shift_date: { lte: maxDate },
      worker_assignments: { none: { deleted_at: null } },
    },
    select: {
      id: true, title: true, status: true, shift_date: true, start_time: true, end_time: true,
      business_profile_id: true, escrow_amount: true, escrow_status: true,
      business_profiles: { select: { user_id: true } },
    },
    take: 100,
  });
};

/**
 * Done shifts still holding escrow with every handshake resolved — the sweeper
 * finalizes these (covers restarts that missed an inline finalize).
 */
export const findShiftsAwaitingFinalize = () => {
  return prisma.shifts.findMany({
    where: {
      deleted_at: null,
      status: { in: ["completed", "payment_pending", "paid"] },
      escrow_status: "held",
      worker_assignments: {
        none: {
          deleted_at: null,
          completion_status: { in: ["pending", "worker_done", "business_done", "disputed"] },
        },
      },
    },
    select: { id: true },
    take: 100,
  });
};

/**
 * Increments a worker reputation counter (completed_shift_count / no_show_count).
 * @param {string} workerProfileId
 * @param {"completed_shift_count"|"no_show_count"} field
 * @param {import("@prisma/client").Prisma.TransactionClient} [client]
 */
export const incrementWorkerCounter = (workerProfileId, field, client = prisma) => {
  return client.worker_profiles.update({
    where: { id: workerProfileId },
    data: { [field]: { increment: 1 } },
  });
};

/**
 * Loads a shift's finalize-relevant columns inside a transaction.
 * @param {string} shiftId
 * @param {import("@prisma/client").Prisma.TransactionClient} [client]
 */
export const findShiftForFinalize = (shiftId, client = prisma) => {
  return client.shifts.findFirst({
    where: { id: shiftId, deleted_at: null },
    select: {
      id: true, title: true, status: true, business_profile_id: true,
      escrow_amount: true, escrow_status: true, pay_amount: true,
    },
  });
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
    select: {
      id: true, status: true, title: true, pay_amount: true,
      business_profile_id: true, escrow_amount: true, escrow_status: true,
    },
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
