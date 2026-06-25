import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";
import * as shiftRepository from "./shift.repository.js";

const { OPEN_STATUSES } = shiftRepository;

// "High pay" threshold in BDT — shifts at or above this are surfaced in the High Pay tab
const HIGH_PAY_THRESHOLD = 1000;

/** Today at local midnight — discovery never shows past shifts. */
const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Tomorrow at local midnight. */
const tomorrow = () => {
  const d = today();
  d.setDate(d.getDate() + 1);
  return d;
};

/** "Urgent" window upper bound — start of the day after tomorrow. */
const urgentBefore = () => {
  const d = today();
  d.setDate(d.getDate() + 2);
  return d;
};

/**
 * Maps a raw shift row to the discovery DTO with filled/capacity counters and
 * the requesting worker's own application state (so the client can show
 * "Applied" and block re-apply).
 * @param {object} shift
 * @param {{ id: string, status: string }} [myApp] - this worker's application on the shift
 */
const toShiftDto = (shift, myApp) => {
  const { applications, ...rest } = shift;
  const filled = applications?.length ?? 0;
  return {
    ...rest,
    filled,
    capacity: shift.workers_needed,
    is_full: filled >= shift.workers_needed,
    // Any existing application (incl. withdrawn) blocks re-apply.
    has_applied: !!myApp,
    my_application: myApp ? { id: myApp.id, status: myApp.status } : null,
  };
};

/**
 * Builds the Prisma where clause for a discovery filter tab.
 * @param {string} filter - all | nearby | urgent | high_pay
 * @param {string[]} preferredZoneIds
 * @param {{ zone_id?: string, category_id?: string }} extra
 */
const buildWhere = (filter, preferredZoneIds, extra) => {
  const where = {
    deleted_at: null,
    status: { in: OPEN_STATUSES },
    shift_date: { gte: today() },
  };

  if (extra.zone_id) where.zone_id = extra.zone_id;
  if (extra.category_id) where.category_id = extra.category_id;

  switch (filter) {
    case "nearby":
      // no preferred zones → no nearby results
      where.zone_id = { in: preferredZoneIds.length ? preferredZoneIds : ["__none__"] };
      break;
    case "urgent":
      where.OR = [
        { shift_type: "instant" },
        { shift_date: { gte: today(), lt: urgentBefore() } },
      ];
      break;
    case "high_pay":
      where.pay_amount = { gte: HIGH_PAY_THRESHOLD };
      break;
    default:
      break; // "all"
  }
  return where;
};

/**
 * Paginated, filtered shift discovery feed for a worker.
 * @param {string} userId
 * @param {{ filter?: string, zone_id?: string, category_id?: string, page?: number, limit?: number }} query
 */
export const listShifts = async (userId, query) => {
  const filter = query.filter ?? "all";
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 10));
  const skip = (page - 1) * limit;

  const preferredZoneIds = filter === "nearby"
    ? await shiftRepository.findPreferredZoneIds(userId)
    : [];

  const where = buildWhere(filter, preferredZoneIds, query);
  const orderBy = filter === "high_pay"
    ? [{ pay_amount: "desc" }]
    : [{ shift_date: "asc" }, { start_time: "asc" }];

  const [rows, total] = await Promise.all([
    shiftRepository.findShifts({ where, orderBy, skip, take: limit }),
    shiftRepository.countShifts(where),
  ]);

  // Flag shifts this worker has already applied to.
  const workerProfileId = await shiftRepository.findWorkerProfileId(userId);
  const myApps = workerProfileId
    ? await shiftRepository.findMyApplications(workerProfileId, rows.map((r) => r.id))
    : [];
  const byShift = new Map(myApps.map((a) => [a.shift_id, a]));

  return {
    items: rows.map((r) => toShiftDto(r, byShift.get(r.id))),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
};

/**
 * Single shift detail. Throws 404 if missing/deleted.
 * @param {string} userId
 * @param {string} id
 */
export const getShiftDetail = async (userId, id) => {
  const shift = await shiftRepository.findShiftById(id);
  if (!shift) throw new AppError("Shift not found", 404);

  const workerProfileId = await shiftRepository.findWorkerProfileId(userId);
  const myApp = workerProfileId
    ? (await shiftRepository.findMyApplications(workerProfileId, [id]))[0]
    : null;
  return toShiftDto(shift, myApp);
};

/**
 * Personalized dashboard counters (Shifts Today / Nearby / Urgent).
 * @param {string} userId
 */
export const getDashboard = async (userId) => {
  const preferredZoneIds = await shiftRepository.findPreferredZoneIds(userId);
  const base = { deleted_at: null, status: { in: OPEN_STATUSES } };

  const [shiftsToday, nearby, urgent] = await Promise.all([
    shiftRepository.countShifts({
      ...base,
      shift_date: { gte: today(), lt: tomorrow() },
    }),
    shiftRepository.countShifts({
      ...base,
      shift_date: { gte: today() },
      zone_id: { in: preferredZoneIds.length ? preferredZoneIds : ["__none__"] },
    }),
    shiftRepository.countShifts({
      ...base,
      shift_date: { gte: today() },
      OR: [{ shift_type: "instant" }, { shift_date: { gte: today(), lt: urgentBefore() } }],
    }),
  ]);

  logger.debug(`Dashboard counters | userId=${userId} today=${shiftsToday} nearby=${nearby} urgent=${urgent}`);
  return { shifts_today: shiftsToday, nearby, urgent };
};
