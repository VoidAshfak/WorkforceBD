import { prisma } from "../../db/index.js";

// Party/context shape shared by worker, business and admin dispute reads.
const disputeInclude = {
  shifts: { select: { id: true, title: true, shift_date: true, pay_amount: true } },
  worker_assignments: {
    select: {
      id: true, completion_status: true, checked_in_at: true, checked_out_at: true,
      paid_amount: true, paid_at: true,
    },
  },
  users_disputes_raised_byTousers: { select: { id: true, full_name: true, phone: true } },
  users_disputes_against_userTousers: { select: { id: true, full_name: true, phone: true } },
};

/**
 * @param {object} data
 * @param {import("@prisma/client").Prisma.TransactionClient} [client]
 */
export const createDispute = (data, client = prisma) => {
  return client.disputes.create({ data, include: disputeInclude });
};

/** @param {string} id */
export const findDisputeById = (id) => {
  return prisma.disputes.findFirst({
    where: { id, deleted_at: null },
    include: disputeInclude,
  });
};

/**
 * An open dispute already covering an assignment (one live dispute per slice).
 * @param {string} assignmentId
 */
export const findOpenDisputeForAssignment = (assignmentId) => {
  return prisma.disputes.findFirst({
    where: { assignment_id: assignmentId, deleted_at: null, status: { in: ["open", "under_review"] } },
    select: { id: true },
  });
};

/**
 * @param {string} id
 * @param {object} data
 * @param {import("@prisma/client").Prisma.TransactionClient} [client]
 */
export const updateDispute = (id, data, client = prisma) => {
  return client.disputes.update({ where: { id }, data, include: disputeInclude });
};

/** @param {{ userId: string, status?: string, skip: number, take: number }} opts */
export const findUserDisputes = ({ userId, status, skip, take }) => {
  const where = {
    deleted_at: null,
    OR: [{ raised_by: userId }, { against_user: userId }],
  };
  if (status) where.status = status;
  return prisma.disputes.findMany({
    where,
    orderBy: { created_at: "desc" },
    skip,
    take,
    include: disputeInclude,
  });
};

/** @param {{ userId: string, status?: string }} opts */
export const countUserDisputes = ({ userId, status }) => {
  const where = {
    deleted_at: null,
    OR: [{ raised_by: userId }, { against_user: userId }],
  };
  if (status) where.status = status;
  return prisma.disputes.count({ where });
};

/** @param {{ status?: string, skip: number, take: number }} opts */
export const findDisputeQueue = ({ status, skip, take }) => {
  const where = { deleted_at: null };
  if (status) where.status = status;
  return prisma.disputes.findMany({
    where,
    orderBy: { created_at: "asc" }, // oldest waiting first
    skip,
    take,
    include: disputeInclude,
  });
};

/** @param {{ status?: string }} opts */
export const countDisputeQueue = ({ status }) => {
  const where = { deleted_at: null };
  if (status) where.status = status;
  return prisma.disputes.count({ where });
};

/** Admin user ids — every open dispute pings the admin inbox. */
export const findAdminUserIds = async () => {
  const rows = await prisma.users.findMany({
    where: { roles: { has: "admin" }, is_active: true, deleted_at: null },
    select: { id: true },
  });
  return rows.map((r) => r.id);
};
