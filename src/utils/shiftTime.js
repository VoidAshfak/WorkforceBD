// Shift time helpers. The DB stores a shift's date/time as Bangladesh wall-clock
// (UTC+6) with no zone info — a shift entered as "18:18" is saved as 18:18 naive.
// Comparing those digits directly against `now` (a real UTC instant) is wrong by
// the app offset, so every "is now inside the shift window" check must convert the
// stored wall-clock to a true UTC instant here first.

import { APP_TZ_OFFSET_MINUTES } from "../constants.js";

/**
 * Converts a shift's stored wall-clock DATE + TIME columns into the real UTC
 * instant they represent.
 * @param {Date} shiftDate  the `shift_date` column (UTC-midnight of the local day)
 * @param {Date} time       a `start_time`/`end_time` column (1970 date + local time)
 * @returns {Date} the UTC instant of that local wall-clock moment
 */
export const shiftInstant = (shiftDate, time) => {
  const naive = Date.UTC(
    shiftDate.getUTCFullYear(), shiftDate.getUTCMonth(), shiftDate.getUTCDate(),
    time.getUTCHours(), time.getUTCMinutes(), time.getUTCSeconds(),
  );
  return new Date(naive - APP_TZ_OFFSET_MINUTES * 60000);
};
