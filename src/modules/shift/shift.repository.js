import { prisma } from "../../db/index.js";
import { Prisma } from "../../prisma/index.js";

// Shifts visible to workers in discovery
export const OPEN_STATUSES = ["published", "applications_open"];

/**
 * Fetches lng/lat for the given shift ids. `coordinates` is a PostGIS geography
 * column Prisma maps as Unsupported and can't select, so pull it via raw SQL
 * (ST_Y = latitude, ST_X = longitude on the cast geometry).
 * @param {string[]} ids
 * @returns {Promise<Map<string, { latitude: number, longitude: number }>>}
 */
const findCoordinatesByShiftIds = async (ids) => {
  if (!ids.length) return new Map();
  const rows = await prisma.$queryRaw`
    SELECT id::text AS id,
           ST_Y(coordinates::geometry) AS latitude,
           ST_X(coordinates::geometry) AS longitude
    FROM shifts
    WHERE id IN (${Prisma.join(ids)}) AND coordinates IS NOT NULL
  `;
  return new Map(rows.map((r) => [r.id, { latitude: r.latitude, longitude: r.longitude }]));
};

/**
 * Attaches a `coordinates` { latitude, longitude } object (or null) to each
 * shift, since the raw column can't ride along on the Prisma query.
 * @param {object[]} shifts
 */
const attachCoordinates = async (shifts) => {
  const coords = await findCoordinatesByShiftIds(shifts.map((s) => s.id));
  return shifts.map((s) => ({ ...s, coordinates: coords.get(s.id) ?? null }));
};

/**
 * Fetches lng/lat for a business profile (same Unsupported-geography problem as
 * shifts). Used to enrich the nested business on shift detail.
 * @param {string} profileId
 * @returns {Promise<{ latitude: number, longitude: number } | null>}
 */
const findBusinessCoordinates = async (profileId) => {
  const rows = await prisma.$queryRaw`
    SELECT ST_Y(coordinates::geometry) AS latitude,
           ST_X(coordinates::geometry) AS longitude
    FROM business_profiles
    WHERE id = ${profileId}::uuid AND coordinates IS NOT NULL
  `;
  return rows[0] ?? null;
};

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
export const findShifts = async ({ where, orderBy, skip, take }) => {
  const rows = await prisma.shifts.findMany({ where, orderBy, skip, take, include: listInclude });
  return attachCoordinates(rows);
};

/** @param {object} where */
export const countShifts = (where) => prisma.shifts.count({ where });

/** @param {string} id */
export const findShiftById = async (id) => {
  const shift = await prisma.shifts.findFirst({
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
  if (!shift) return null;
  const [withCoords] = await attachCoordinates([shift]);
  if (withCoords.business_profiles) {
    withCoords.business_profiles.coordinates = await findBusinessCoordinates(
      withCoords.business_profiles.id,
    );
  }
  return withCoords;
};

/**
 * Worker profile id for a user (applications are keyed by it).
 * @param {string} userId
 * @returns {Promise<string|null>}
 */
export const findWorkerProfileId = async (userId) => {
  const profile = await prisma.worker_profiles.findUnique({
    where: { user_id: userId },
    select: { id: true },
  });
  return profile?.id ?? null;
};

/**
 * The worker's own applications across the given shifts — used to flag
 * already-applied shifts in discovery. One row per shift (unique constraint).
 * @param {string} workerProfileId
 * @param {string[]} shiftIds
 * @returns {Promise<{ id: string, shift_id: string, status: string }[]>}
 */
export const findMyApplications = (workerProfileId, shiftIds) => {
  if (!shiftIds.length) return Promise.resolve([]);
  return prisma.applications.findMany({
    where: { worker_profile_id: workerProfileId, shift_id: { in: shiftIds }, deleted_at: null },
    select: { id: true, shift_id: true, status: true },
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
