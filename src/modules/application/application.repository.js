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

/**
 * Loads the roster assignment plus the shift context needed to validate a
 * worker check-in/out (time window, QR token, owning business for notifying).
 * Coordinates are excluded here (Unsupported geography) — distance is checked
 * separately via {@link isWithinShiftGeofence}.
 * @param {string} applicationId
 * @param {string} workerProfileId
 */
export const findAssignmentContext = (applicationId, workerProfileId) => {
  return prisma.worker_assignments.findFirst({
    where: { application_id: applicationId, worker_profile_id: workerProfileId, deleted_at: null },
    select: {
      id: true,
      checked_in_at: true,
      checked_out_at: true,
      shift_id: true,
      shifts: {
        select: {
          id: true, title: true, status: true,
          shift_date: true, start_time: true, end_time: true,
          workers_needed: true, checkin_qr_token: true,
          business_profiles: { select: { user_id: true } },
        },
      },
    },
  });
};

/**
 * Whether the given point lies within `radiusMeters` of the shift's coordinates.
 * Returns false when the shift has no coordinates set.
 * @param {string} shiftId
 * @param {number} latitude
 * @param {number} longitude
 * @param {number} radiusMeters
 * @returns {Promise<boolean>}
 */
export const isWithinShiftGeofence = async (shiftId, latitude, longitude, radiusMeters) => {
  const rows = await prisma.$queryRaw`
    SELECT ST_DWithin(
             coordinates,
             ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
             ${radiusMeters}
           ) AS within
    FROM shifts
    WHERE id = ${shiftId}::uuid AND coordinates IS NOT NULL
  `;
  return rows[0]?.within === true;
};

/**
 * Atomically stamps a check-in only if the assignment is not already checked in.
 * Returns the number of rows updated — 0 means a concurrent request won the race
 * (already checked in), guarding against double check-in / double notification.
 * @param {string} assignmentId
 * @param {"manual"|"gps"|"qr"|"pin"} method
 * @param {Date} at  check-in timestamp (shared with the window check)
 * @returns {Promise<number>}
 */
export const setCheckIn = async (assignmentId, method, at) => {
  const { count } = await prisma.worker_assignments.updateMany({
    where: { id: assignmentId, checked_in_at: null },
    data: { checked_in_at: at, checkin_method: method },
  });
  return count;
};

/**
 * Stamps a check-out on the assignment.
 * @param {string} assignmentId
 */
export const setCheckOut = (assignmentId) => {
  return prisma.worker_assignments.update({
    where: { id: assignmentId },
    data: { checked_out_at: new Date() },
  });
};

/** Count of workers already checked in on a shift. @param {string} shiftId */
export const countCheckedIn = (shiftId) => {
  return prisma.worker_assignments.count({
    where: { shift_id: shiftId, checked_in_at: { not: null }, deleted_at: null },
  });
};
