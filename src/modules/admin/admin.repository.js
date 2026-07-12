import { prisma } from "../../db/index.js";

// Maps a verification type to its Prisma model.
const models = {
  worker: prisma.worker_profiles,
  business: prisma.business_profiles,
};

// Columns returned for each profile type in the review queue / detail.
const selectByType = {
  worker: {
    id: true,
    user_id: true,
    full_name: true,
    verification_status: true,
    verification_note: true,
    nid_front_url: true,
    nid_back_url: true,
    selfie_url: true,
    student_id_url: true,
    created_at: true,
    updated_at: true,
    users: { select: { phone: true, roles: true } },
  },
  business: {
    id: true,
    user_id: true,
    business_name: true,
    business_type: true,
    verification_status: true,
    verification_note: true,
    trade_license_url: true,
    business_doc_url: true,
    created_at: true,
    updated_at: true,
    users: { select: { phone: true, roles: true } },
  },
};

/**
 * @param {{ type: "worker"|"business", status: string, skip: number, take: number }} opts
 */
export const findProfilesForReview = ({ type, status, skip, take }) => {
  return models[type].findMany({
    where: { verification_status: status, deleted_at: null },
    orderBy: { updated_at: "asc" }, // oldest waiting first
    skip,
    take,
    select: selectByType[type],
  });
};

/** @param {{ type: "worker"|"business", status: string }} opts */
export const countProfilesForReview = ({ type, status }) => {
  return models[type].count({ where: { verification_status: status, deleted_at: null } });
};

/**
 * @param {"worker"|"business"} type
 * @param {string} id
 */
export const findProfileById = (type, id) => {
  return models[type].findFirst({
    where: { id, deleted_at: null },
    select: selectByType[type],
  });
};

/**
 * @param {"worker"|"business"} type
 * @param {string} id
 * @param {object} data
 */
export const updateVerification = (type, id, data) => {
  return models[type].update({ where: { id }, data });
};

/* ============================================================
 * Shift-post moderation
 * ========================================================== */

const shiftReviewInclude = {
  business_profiles: { select: { id: true, user_id: true, business_name: true, verification_status: true } },
  categories: { select: { id: true, name: true } },
  zones: { select: { id: true, name: true } },
};

/** @param {{ status: string, skip: number, take: number }} opts */
export const findShiftsForReview = ({ status, skip, take }) => {
  return prisma.shifts.findMany({
    where: { status, deleted_at: null },
    orderBy: { updated_at: "asc" }, // oldest waiting first
    skip,
    take,
    include: shiftReviewInclude,
  });
};

/** @param {{ status: string }} opts */
export const countShiftsForReview = ({ status }) => {
  return prisma.shifts.count({ where: { status, deleted_at: null } });
};

/** @param {string} id */
export const findShiftById = (id) => {
  return prisma.shifts.findFirst({ where: { id, deleted_at: null }, include: shiftReviewInclude });
};

/**
 * @param {string} id
 * @param {object} data
 * @param {import("../../prisma/index.js").Prisma.TransactionClient} [client]
 */
export const updateShiftStatus = (id, data, client = prisma) => client.shifts.update({ where: { id }, data });

/* ============================================================
 * Platform monitoring (dashboard + analytics)
 * ========================================================== */

/** Headline counters for the admin dashboard — one round trip of counts/sums. */
export const collectDashboardCounts = async () => {
  const [
    usersTotal, usersBlocked, workers, businesses,
    workerVerificationsPending, businessVerificationsPending,
    shiftsPendingApproval, shiftsOpen, shiftsLive, shiftsTotal,
    disputesOpen, handshakesAwaiting,
    escrowHeld, feeRevenue, workerEarnings,
  ] = await Promise.all([
    prisma.users.count({ where: { deleted_at: null } }),
    prisma.users.count({ where: { deleted_at: null, is_active: false } }),
    prisma.worker_profiles.count({ where: { deleted_at: null } }),
    prisma.business_profiles.count({ where: { deleted_at: null } }),
    prisma.worker_profiles.count({ where: { deleted_at: null, verification_status: "pending" } }),
    prisma.business_profiles.count({ where: { deleted_at: null, verification_status: "pending" } }),
    prisma.shifts.count({ where: { deleted_at: null, status: "pending_approval" } }),
    prisma.shifts.count({ where: { deleted_at: null, status: { in: ["published", "applications_open"] } } }),
    prisma.shifts.count({ where: { deleted_at: null, status: { in: ["worker_selected", "worker_confirmed", "checked_in", "active"] } } }),
    prisma.shifts.count({ where: { deleted_at: null } }),
    prisma.disputes.count({ where: { status: "open", deleted_at: null } }),
    prisma.worker_assignments.count({ where: { deleted_at: null, completion_status: { in: ["worker_done", "business_done"] } } }),
    prisma.shifts.aggregate({ _sum: { escrow_amount: true }, where: { escrow_status: "held", deleted_at: null } }),
    prisma.business_wallet_transactions.aggregate({ _sum: { amount: true }, where: { reference_id: "platform_fee" } }),
    prisma.wallets.aggregate({ _sum: { total_earned: true } }),
  ]);

  return {
    users: { total: usersTotal, workers, businesses, blocked: usersBlocked },
    pending_review: {
      worker_verifications: workerVerificationsPending,
      business_verifications: businessVerificationsPending,
      shift_posts: shiftsPendingApproval,
      open_disputes: disputesOpen,
      handshakes_awaiting_confirm: handshakesAwaiting,
    },
    shifts: { total: shiftsTotal, open: shiftsOpen, live: shiftsLive },
    money: {
      escrow_held: escrowHeld._sum.escrow_amount ?? 0,
      platform_fee_collected: feeRevenue._sum.amount ?? 0,
      worker_earnings_total: workerEarnings._sum.total_earned ?? 0,
    },
  };
};

/**
 * Daily time series for the dashboard graphs. Each query buckets rows by
 * calendar day over the window; the service zero-fills missing days.
 * @param {Date} since window start (inclusive)
 */
export const collectDailySeries = async (since) => {
  const [signups, shiftsCreated, payouts, fees, disputes] = await Promise.all([
    prisma.$queryRaw`
      SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::int AS count
      FROM users WHERE created_at >= ${since} AND deleted_at IS NULL
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw`
      SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::int AS count
      FROM shifts WHERE created_at >= ${since} AND deleted_at IS NULL
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw`
      SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::int AS count,
             COALESCE(SUM(amount), 0)::float AS amount
      FROM transactions
      WHERE created_at >= ${since} AND type = 'credit' AND assignment_id IS NOT NULL AND deleted_at IS NULL
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw`
      SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::int AS count,
             COALESCE(SUM(amount), 0)::float AS amount
      FROM business_wallet_transactions
      WHERE created_at >= ${since} AND reference_id = 'platform_fee'
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw`
      SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::int AS count
      FROM disputes WHERE created_at >= ${since} AND deleted_at IS NULL
      GROUP BY 1 ORDER BY 1`,
  ]);
  return { signups, shiftsCreated, payouts, fees, disputes };
};

/* ============================================================
 * User management (list / detail / block)
 * ========================================================== */

const userListSelect = {
  id: true,
  phone: true,
  email: true,
  full_name: true,
  roles: true,
  is_active: true,
  created_at: true,
  worker_profiles: { select: { id: true, full_name: true, verification_status: true, reliability_score: true } },
  business_profiles: { select: { id: true, business_name: true, verification_status: true, reliability_score: true } },
};

/** Builds the where clause for the admin user list filters. */
const userListWhere = ({ role, status, search }) => {
  const where = { deleted_at: null };
  if (role) where.roles = { has: role };
  if (status === "blocked") where.is_active = false;
  if (status === "active") where.is_active = true;
  if (search) {
    where.OR = [
      { phone: { contains: search } },
      { full_name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { worker_profiles: { full_name: { contains: search, mode: "insensitive" } } },
      { business_profiles: { business_name: { contains: search, mode: "insensitive" } } },
    ];
  }
  return where;
};

/** @param {{ role?: string, status?: string, search?: string, skip: number, take: number }} opts */
export const findUsers = ({ role, status, search, skip, take }) => {
  return prisma.users.findMany({
    where: userListWhere({ role, status, search }),
    orderBy: { created_at: "desc" },
    skip,
    take,
    select: userListSelect,
  });
};

/** @param {{ role?: string, status?: string, search?: string }} opts */
export const countUsers = ({ role, status, search }) =>
  prisma.users.count({ where: userListWhere({ role, status, search }) });

/** Full user detail for the admin panel, including sanction history. */
export const findUserDetail = (userId) => {
  return prisma.users.findFirst({
    where: { id: userId, deleted_at: null },
    select: {
      ...userListSelect,
      is_phone_verified: true,
      updated_at: true,
      worker_profiles: {
        select: {
          id: true, full_name: true, verification_status: true, reliability_score: true,
          completed_shift_count: true, no_show_count: true,
        },
      },
      business_profiles: {
        select: {
          id: true, business_name: true, verification_status: true, reliability_score: true,
          _count: { select: { shifts: true } },
        },
      },
      wallets: { select: { balance: true, total_earned: true } },
      user_sanctions_user_sanctions_user_idTousers: {
        where: { deleted_at: null },
        orderBy: { created_at: "desc" },
        select: { id: true, sanction_type: true, reason: true, severity: true, is_active: true, created_at: true, expires_at: true },
      },
    },
  });
};

/**
 * @param {string} userId
 * @param {object} data
 * @param {import("../../prisma/index.js").Prisma.TransactionClient} [client]
 */
export const updateUser = (userId, data, client = prisma) =>
  client.users.update({ where: { id: userId }, data });

/**
 * @param {{ user_id: string, sanction_type: string, reason: string, severity?: string, issued_by: string }} data
 * @param {import("../../prisma/index.js").Prisma.TransactionClient} [client]
 */
export const createSanction = (data, client = prisma) => client.user_sanctions.create({ data });

/**
 * Deactivates every active sanction on a user (unblock).
 * @param {string} userId
 * @param {string} adminId
 * @param {import("../../prisma/index.js").Prisma.TransactionClient} [client]
 */
export const deactivateSanctions = (userId, adminId, client = prisma) =>
  client.user_sanctions.updateMany({
    where: { user_id: userId, is_active: true, deleted_at: null },
    data: { is_active: false, updated_by: adminId },
  });
