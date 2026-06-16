import { prisma } from "../../db/index.js";

/**
 * Worker profile essentials needed for application guards.
 * @param {string} userId
 */
export const findWorkerProfile = (userId) => {
  return prisma.worker_profiles.findUnique({
    where: { user_id: userId },
    select: { id: true, verification_status: true },
  });
};

/** @param {string} shiftId */
export const findShiftById = (shiftId) => {
  return prisma.shifts.findFirst({
    where: { id: shiftId, deleted_at: null },
    select: { id: true, status: true, shift_date: true, workers_needed: true },
  });
};

/**
 * @param {string} shiftId
 * @param {string} workerProfileId
 */
export const findApplication = (shiftId, workerProfileId) => {
  return prisma.applications.findUnique({
    where: { shift_id_worker_profile_id: { shift_id: shiftId, worker_profile_id: workerProfileId } },
  });
};

/** Accepted applications occupying slots on a shift. @param {string} shiftId */
export const countAccepted = (shiftId) => {
  return prisma.applications.count({
    where: { shift_id: shiftId, status: "accepted", deleted_at: null },
  });
};

/**
 * @param {{ shift_id: string, worker_profile_id: string, note?: string }} data
 */
export const createApplication = (data) => {
  return prisma.applications.create({ data });
};

/**
 * @param {string} id
 * @param {object} data
 */
export const updateApplication = (id, data) => {
  return prisma.applications.update({ where: { id }, data });
};

/**
 * Worker's applications (activity tracker), newest first.
 * @param {string} workerProfileId
 * @param {{ status?: string, skip: number, take: number }} opts
 */
export const findWorkerApplications = (workerProfileId, { status, skip, take }) => {
  const where = { worker_profile_id: workerProfileId, deleted_at: null };
  if (status) where.status = status;

  return prisma.applications.findMany({
    where,
    orderBy: { applied_at: "desc" },
    skip,
    take,
    include: {
      shifts: {
        select: {
          id: true, title: true, shift_date: true, start_time: true, end_time: true,
          pay_amount: true, status: true,
          business_profiles: { select: { business_name: true, logo_url: true } },
          zones: { select: { name: true } },
        },
      },
    },
  });
};

/**
 * @param {string} workerProfileId
 * @param {{ status?: string }} opts
 */
export const countWorkerApplications = (workerProfileId, { status }) => {
  const where = { worker_profile_id: workerProfileId, deleted_at: null };
  if (status) where.status = status;
  return prisma.applications.count({ where });
};

/**
 * Fetch an application that belongs to the given worker.
 * @param {string} id
 * @param {string} workerProfileId
 */
export const findOwnedApplication = (id, workerProfileId) => {
  return prisma.applications.findFirst({
    where: { id, worker_profile_id: workerProfileId, deleted_at: null },
  });
};
