import { prisma } from "../../db/index.js";

// Shifts visible to workers in discovery
export const OPEN_STATUSES = ["published", "applications_open"];

const listInclude = {
  business_profiles: {
    select: { id: true, business_name: true, logo_url: true },
  },
  categories: { select: { id: true, name: true } },
  zones: { select: { id: true, name: true } },
  // accepted applications = filled slots
  applications: {
    where: { status: "accepted", deleted_at: null },
    select: { id: true },
  },
};

/**
 * @param {object} params
 * @param {object} params.where - Prisma where clause
 * @param {object} params.orderBy
 * @param {number} params.skip
 * @param {number} params.take
 */
export const findShifts = ({ where, orderBy, skip, take }) => {
  return prisma.shifts.findMany({ where, orderBy, skip, take, include: listInclude });
};

/** @param {object} where */
export const countShifts = (where) => prisma.shifts.count({ where });

/** @param {string} id */
export const findShiftById = (id) => {
  return prisma.shifts.findFirst({
    where: { id, deleted_at: null },
    include: {
      business_profiles: {
        select: {
          id: true,
          business_name: true,
          logo_url: true,
          reliability_score: true,
          verification_status: true,
        },
      },
      categories: { select: { id: true, name: true } },
      zones: { select: { id: true, name: true } },
      applications: {
        where: { status: "accepted", deleted_at: null },
        select: { id: true },
      },
    },
  });
};

/**
 * Preferred zone IDs for a worker, used by the "nearby" filter.
 * @param {string} userId
 * @returns {Promise<string[]>}
 */
export const findPreferredZoneIds = async (userId) => {
  const profile = await prisma.worker_profiles.findUnique({
    where: { user_id: userId },
    select: { worker_preferred_zones: { select: { zone_id: true } } },
  });
  return profile?.worker_preferred_zones.map((z) => z.zone_id) ?? [];
};
