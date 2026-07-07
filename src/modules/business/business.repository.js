import { prisma } from "../../db/index.js";

/* ============================================================
 * Business profile
 * ========================================================== */

/**
 * Fetches lng/lat for a business profile. `coordinates` is a PostGIS geography
 * column Prisma maps as Unsupported and can't select, so pull it via raw SQL
 * (ST_Y = latitude, ST_X = longitude on the cast geometry).
 * @param {string} profileId
 * @returns {Promise<{ latitude: number, longitude: number } | null>}
 */
export const findProfileCoordinates = async (profileId) => {
  const rows = await prisma.$queryRaw`
    SELECT ST_Y(coordinates::geometry) AS latitude,
           ST_X(coordinates::geometry) AS longitude
    FROM business_profiles
    WHERE id = ${profileId}::uuid AND coordinates IS NOT NULL
  `;
  return rows[0] ?? null;
};

/**
 * Full business profile for the owning user, with its zone and decoded
 * `coordinates` ({ latitude, longitude } or null).
 * @param {string} userId
 */
export const findProfileByUserId = async (userId) => {
  const profile = await prisma.business_profiles.findUnique({
    where: { user_id: userId },
    include: { zones: { select: { id: true, name: true } } },
  });
  if (!profile) return null;
  return { ...profile, coordinates: await findProfileCoordinates(profile.id) };
};

/**
 * Lightweight profile identity used by guards (existence + verification state).
 * @param {string} userId
 */
export const findProfileSummary = (userId) => {
  return prisma.business_profiles.findUnique({
    where: { user_id: userId },
    select: { id: true, verification_status: true, zone_id: true, address: true, landmark: true, manager_phone: true },
  });
};

/**
 * @param {string} userId
 * @param {object} data
 */
export const createProfile = (userId, data) => {
  return prisma.business_profiles.create({ data: { user_id: userId, created_by: userId, ...data } });
};

/**
 * @param {string} id
 * @param {object} data
 */
export const updateProfile = (id, data) => {
  return prisma.business_profiles.update({ where: { id }, data });
};

/* ============================================================
 * Reference-data validation
 * ========================================================== */

/** @param {string} zoneId */
export const findActiveZone = (zoneId) => {
  return prisma.zones.findFirst({ where: { id: zoneId, is_active: true }, select: { id: true } });
};

/** @param {string} categoryId */
export const findActiveCategory = (categoryId) => {
  return prisma.categories.findFirst({ where: { id: categoryId, is_active: true }, select: { id: true } });
};

/* ============================================================
 * Shifts (business-owned)
 * ========================================================== */

// Status buckets shared by service-layer rules.
export const ACTIVE_SHIFT_STATUSES = ["published", "applications_open"];

/**
 * @param {object} data
 * @param {import("../../prisma/index.js").Prisma.TransactionClient} [client]
 */
export const createShift = (data, client = prisma) => client.shifts.create({ data });

/**
 * Finds a live (not cancelled/deleted) shift by the same business that overlaps
 * the given slot — same category, date and start time. Used to warn on an
 * accidental duplicate post before creating another one.
 * @param {{ businessProfileId: string, categoryId: string, shiftDate: Date, startTime: Date }} opts
 */
export const findDuplicateShift = ({ businessProfileId, categoryId, shiftDate, startTime }) => {
  return prisma.shifts.findFirst({
    where: {
      business_profile_id: businessProfileId,
      category_id: categoryId,
      shift_date: shiftDate,
      start_time: startTime,
      deleted_at: null,
      status: { not: "cancelled" },
    },
    select: { id: true, title: true },
  });
};

/**
 * Shift owned by a business, with live applicant/hire counters. 404-safe via findFirst.
 * @param {string} shiftId
 * @param {string} businessProfileId
 */
export const findOwnedShift = (shiftId, businessProfileId) => {
  return prisma.shifts.findFirst({
    where: { id: shiftId, business_profile_id: businessProfileId, deleted_at: null },
    include: {
      categories: { select: { id: true, name: true } },
      zones: { select: { id: true, name: true } },
      _count: {
        select: {
          applications: { where: { deleted_at: null, status: { in: ["pending", "shortlisted"] } } },
        },
      },
      applications: {
        where: { status: "accepted", deleted_at: null },
        select: { id: true },
      },
    },
  });
};

/**
 * Minimal owned-shift record for transition guards.
 * @param {string} shiftId
 * @param {string} businessProfileId
 */
export const findOwnedShiftBasic = (shiftId, businessProfileId) => {
  return prisma.shifts.findFirst({
    where: { id: shiftId, business_profile_id: businessProfileId, deleted_at: null },
    select: {
      id: true, status: true, workers_needed: true, shift_date: true,
      pay_amount: true, business_profile_id: true, escrow_amount: true, escrow_status: true,
    },
  });
};

/**
 * @param {{ businessProfileId: string, status?: string, skip: number, take: number }} opts
 */
export const findOwnedShifts = ({ businessProfileId, status, skip, take }) => {
  const where = { business_profile_id: businessProfileId, deleted_at: null };
  if (status) where.status = status;

  return prisma.shifts.findMany({
    where,
    orderBy: [{ shift_date: "desc" }, { start_time: "desc" }],
    skip,
    take,
    include: {
      categories: { select: { id: true, name: true } },
      zones: { select: { id: true, name: true } },
      _count: {
        select: {
          applications: { where: { deleted_at: null, status: { in: ["pending", "shortlisted"] } } },
        },
      },
      applications: {
        where: { status: "accepted", deleted_at: null },
        select: { id: true },
      },
    },
  });
};

/** @param {{ businessProfileId: string, status?: string }} opts */
export const countOwnedShifts = ({ businessProfileId, status }) => {
  const where = { business_profile_id: businessProfileId, deleted_at: null };
  if (status) where.status = status;
  return prisma.shifts.count({ where });
};

/**
 * @param {string} id
 * @param {object} data
 * @param {import("../../prisma/index.js").Prisma.TransactionClient} [client]
 */
export const updateShift = (id, data, client = prisma) => client.shifts.update({ where: { id }, data });

/**
 * Sets a shift's map-pin location. `coordinates` is a PostGIS geography Prisma
 * can't write through the model, so build the point via raw SQL (lng, lat order).
 * @param {string} shiftId
 * @param {number} latitude
 * @param {number} longitude
 * @param {import("../../prisma/index.js").Prisma.TransactionClient} [client]
 */
export const setShiftCoordinates = (shiftId, latitude, longitude, client = prisma) => {
  return client.$executeRaw`
    UPDATE shifts
    SET coordinates = ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
        updated_at = now()
    WHERE id = ${shiftId}::uuid
  `;
};

/**
 * Decoded map-pin of a shift ({ latitude, longitude }) or null when unset.
 * @param {string} shiftId
 */
export const findShiftCoordinates = async (shiftId) => {
  const rows = await prisma.$queryRaw`
    SELECT ST_Y(coordinates::geometry) AS latitude,
           ST_X(coordinates::geometry) AS longitude
    FROM shifts
    WHERE id = ${shiftId}::uuid AND coordinates IS NOT NULL
  `;
  return rows[0] ?? null;
};

/* ============================================================
 * Business wallet (escrow funding)
 * ========================================================== */

// Client-safe wallet columns.
const businessWalletSelect = { id: true, balance: true, held: true, total_spent: true, currency: true };

/**
 * Business wallet, created on first access (one per business profile). New wallets
 * are seeded with a starting balance — see BUSINESS_WALLET_SEED_BALANCE.
 * @param {string} businessProfileId
 * @param {string} userId actor id recorded as creator
 * @param {number} seedBalance starting balance for a freshly created wallet
 * @param {import("../../prisma/index.js").Prisma.TransactionClient} [client]
 */
export const ensureBusinessWallet = (businessProfileId, userId, seedBalance, client = prisma) => {
  return client.business_wallets.upsert({
    where: { business_profile_id: businessProfileId },
    update: {},
    create: { business_profile_id: businessProfileId, balance: seedBalance, created_by: userId },
    select: businessWalletSelect,
  });
};

/**
 * @param {string} id
 * @param {object} data
 * @param {import("../../prisma/index.js").Prisma.TransactionClient} [client]
 */
export const updateBusinessWallet = (id, data, client = prisma) => {
  return client.business_wallets.update({ where: { id }, data, select: businessWalletSelect });
};

/** @param {object} where */
export const countShifts = (where) => prisma.shifts.count({ where });

/**
 * Owned shift with everything the cancellation-penalty engine needs: timing +
 * type (eligibility), pay/escrow (money), and the owning business's reliability.
 * @param {string} shiftId
 * @param {string} businessProfileId
 */
export const findShiftForCancellation = (shiftId, businessProfileId) => {
  return prisma.shifts.findFirst({
    where: { id: shiftId, business_profile_id: businessProfileId, deleted_at: null },
    select: {
      id: true, title: true, status: true, shift_type: true,
      shift_date: true, start_time: true, end_time: true,
      pay_amount: true, workers_needed: true,
      business_profile_id: true, escrow_amount: true, escrow_status: true,
      business_profiles: { select: { reliability_score: true } },
    },
  });
};

/**
 * Hired (accepted) workers on a shift with the per-worker signals the penalty
 * engine needs: reliability, hire time (assignment created_at), and whether they
 * checked in (drives expiry + which assignment to mark compensated).
 * @param {string} shiftId
 */
export const findHiredForCancellation = (shiftId) => {
  return prisma.applications.findMany({
    where: { shift_id: shiftId, status: "accepted", deleted_at: null },
    select: {
      id: true,
      worker_profiles: { select: { id: true, user_id: true, full_name: true, reliability_score: true } },
      worker_assignments: {
        where: { deleted_at: null },
        select: { id: true, created_at: true, checked_in_at: true },
        take: 1,
      },
    },
  });
};

/** Active (non-withdrawn/non-rejected) applicant count — a shift demand signal. @param {string} shiftId */
export const countActiveApplicants = (shiftId) => {
  return prisma.applications.count({
    where: { shift_id: shiftId, deleted_at: null, status: { in: ["pending", "shortlisted", "accepted"] } },
  });
};

/* ============================================================
 * Applicants (business side of applications)
 * ========================================================== */

/** Accepted (hired) applications occupying slots on a shift. @param {string} shiftId */
export const countAcceptedForShift = (shiftId) => {
  return prisma.applications.count({
    where: { shift_id: shiftId, status: "accepted", deleted_at: null },
  });
};

/**
 * Applicants for a shift with worker reputation telemetry.
 * @param {{ shiftId: string, status?: string, skip: number, take: number }} opts
 */
export const findShiftApplicants = ({ shiftId, status, skip, take }) => {
  const where = { shift_id: shiftId, deleted_at: null };
  if (status) where.status = status;

  return prisma.applications.findMany({
    where,
    orderBy: { applied_at: "asc" },
    skip,
    take,
    include: {
      worker_profiles: {
        select: {
          id: true,
          full_name: true,
          profile_picture: true,
          verification_status: true,
          reliability_score: true,
          attendance_rate: true,
          completion_rate: true,
          no_show_count: true,
          completed_shift_count: true,
        },
      },
    },
  });
};

/**
 * Owned shift with the fields the live-attendance roster needs (incl. the
 * QR token the business displays for workers to scan).
 * @param {string} shiftId
 * @param {string} businessProfileId
 */
export const findOwnedShiftForRoster = (shiftId, businessProfileId) => {
  return prisma.shifts.findFirst({
    where: { id: shiftId, business_profile_id: businessProfileId, deleted_at: null },
    select: {
      id: true, title: true, status: true, workers_needed: true,
      shift_date: true, start_time: true, end_time: true, checkin_qr_token: true,
    },
  });
};

/**
 * Roster assignments for a shift with worker identity + check-in stamps,
 * ordered by check-in time (checked-in first), then name.
 * @param {string} shiftId
 */
export const findShiftRoster = (shiftId) => {
  return prisma.worker_assignments.findMany({
    where: { shift_id: shiftId, deleted_at: null },
    orderBy: [{ checked_in_at: { sort: "asc", nulls: "last" } }],
    select: {
      id: true,
      checked_in_at: true,
      checked_out_at: true,
      checkin_method: true,
      worker_profiles: {
        select: { id: true, full_name: true, profile_picture: true, reliability_score: true },
      },
    },
  });
};

/** @param {{ shiftId: string, status?: string }} opts */
export const countShiftApplicants = ({ shiftId, status }) => {
  const where = { shift_id: shiftId, deleted_at: null };
  if (status) where.status = status;
  return prisma.applications.count({ where });
};

/**
 * Application joined to its shift — used to enforce business ownership before
 * any decision, plus the worker's user_id for notifications.
 * @param {string} applicationId
 * @param {string} businessProfileId
 */
export const findOwnedApplication = (applicationId, businessProfileId) => {
  return prisma.applications.findFirst({
    where: {
      id: applicationId,
      deleted_at: null,
      shifts: { business_profile_id: businessProfileId, deleted_at: null },
    },
    include: {
      shifts: { select: { id: true, title: true, status: true, workers_needed: true } },
      worker_profiles: { select: { id: true, user_id: true, full_name: true } },
    },
  });
};

/**
 * @param {string} id
 * @param {object} data
 * @param {import("../../prisma/index.js").Prisma.TransactionClient} [client] optional tx client
 */
export const updateApplication = (id, data, client = prisma) =>
  client.applications.update({ where: { id }, data });

/**
 * Still-decidable applications (pending/shortlisted) on an owned shift, scoped to
 * the given id set, with the data needed to notify each worker. Used by bulk
 * shortlist/reject so only eligible, owned rows are touched.
 * @param {string[]} applicationIds
 * @param {string} businessProfileId
 * @param {string} shiftId
 */
export const findOwnedApplicationsForBulk = (applicationIds, businessProfileId, shiftId) => {
  return prisma.applications.findMany({
    where: {
      id: { in: applicationIds },
      shift_id: shiftId,
      deleted_at: null,
      status: { in: ["pending", "shortlisted"] },
      shifts: { business_profile_id: businessProfileId, deleted_at: null },
    },
    include: {
      shifts: { select: { id: true, title: true } },
      worker_profiles: { select: { user_id: true } },
    },
  });
};

/**
 * Sets the same status on a batch of applications.
 * @param {string[]} ids
 * @param {string} status
 * @param {string} userId actor
 */
export const updateApplicationsStatus = (ids, status, userId) => {
  return prisma.applications.updateMany({
    where: { id: { in: ids } },
    data: { status, updated_by: userId },
  });
};

/**
 * Creates (or revives) the worker assignment that backs the live-attendance
 * roster. Upsert keyed on the unique (shift, worker) pair so re-hiring a worker
 * who previously withdrew resets their check-in state instead of failing.
 * @param {{ shift_id: string, application_id: string, worker_profile_id: string, created_by: string }} data
 * @param {import("../../prisma/index.js").Prisma.TransactionClient} [client] optional tx client
 */
export const upsertAssignment = (data, client = prisma) => {
  return client.worker_assignments.upsert({
    where: {
      shift_id_worker_profile_id: {
        shift_id: data.shift_id,
        worker_profile_id: data.worker_profile_id,
      },
    },
    create: { ...data, payment_status: "pending" },
    update: {
      application_id: data.application_id,
      checkin_method: null,
      checked_in_at: null,
      checked_out_at: null,
      payment_status: "pending",
      updated_by: data.created_by,
    },
  });
};

/* ============================================================
 * Dashboard aggregates
 * ========================================================== */

/** Pending + shortlisted applicants awaiting a decision across all of a business's shifts. */
export const countPendingApplicants = (businessProfileId) => {
  return prisma.applications.count({
    where: {
      deleted_at: null,
      status: { in: ["pending", "shortlisted"] },
      shifts: { business_profile_id: businessProfileId, deleted_at: null },
    },
  });
};

/**
 * Active shifts reduced to staffing pairs (needed vs hired) for fill-rate /
 * understaffing math. Bounded by the small number of active shifts a business runs.
 */
export const findActiveStaffing = (businessProfileId) => {
  return prisma.shifts.findMany({
    where: {
      business_profile_id: businessProfileId,
      deleted_at: null,
      status: { in: ACTIVE_SHIFT_STATUSES },
    },
    select: {
      workers_needed: true,
      _count: { select: { applications: { where: { status: "accepted", deleted_at: null } } } },
    },
  });
};

