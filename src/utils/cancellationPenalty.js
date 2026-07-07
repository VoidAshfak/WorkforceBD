// Shift cancellation penalty engine (pure — no DB, no money types).
//
// When a business deletes a shift that already has hired workers, the workers are
// owed compensation. This module decides *whether* a penalty applies and computes
// a per-worker penalty *rate* (a fraction of the shift's pay_amount). The caller
// turns rates into money and moves it. All tuning lives in constants.js.
//
// Rate = timing base (dominant) + four capped adjustment factors, clamped:
//   base                 how close `now` is to the shift start (instant floors higher)
//   + duration           how long the worker has been committed (hours since hired)
//   + worker reliability  protect reliable workers who turned down other work
//   + business reliability penalise businesses that cancel often / are unrated-low
//   + demand              applicants-per-slot on this shift (in-demand worker)

import {
  CANCEL_FREE_NOTICE_HOURS,
  PENALTY_MIN_RATE,
  PENALTY_MAX_RATE,
  PENALTY_TIMING_MIN_RATE,
  PENALTY_TIMING_MAX_RATE,
  PENALTY_INSTANT_BASE,
  PENALTY_FACTOR_WEIGHT,
  PENALTY_DURATION_SATURATION_HOURS,
  PENALTY_DEMAND_SATURATION_RATIO,
  RELIABILITY_MAX_SCORE,
  RELIABILITY_NEUTRAL_NORM,
} from "../constants.js";

const HOUR_MS = 3600000;
const clamp01 = (n) => Math.min(1, Math.max(0, n));
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const round = (n, dp) => Number(n.toFixed(dp));

/**
 * Normalises a reliability_score (0–RELIABILITY_MAX_SCORE) to 0..1. Unrated
 * profiles (score <= 0) map to a neutral value so new users are neither punished
 * nor rewarded by the reliability factors.
 * @param {number|string|null} score
 */
const reliabilityNorm = (score) => {
  const s = Number(score) || 0;
  return s <= 0 ? RELIABILITY_NEUTRAL_NORM : clamp01(s / RELIABILITY_MAX_SCORE);
};

/**
 * Timing base rate — PENALTY_TIMING_MIN_RATE at the free-notice boundary rising to
 * PENALTY_TIMING_MAX_RATE at/after start. Instant shifts floor at PENALTY_INSTANT_BASE.
 * @param {string} shiftType
 * @param {number} hoursToStart
 */
const timingBase = (shiftType, hoursToStart) => {
  const closeness = clamp01(1 - hoursToStart / CANCEL_FREE_NOTICE_HOURS);
  const scheduled =
    PENALTY_TIMING_MIN_RATE + (PENALTY_TIMING_MAX_RATE - PENALTY_TIMING_MIN_RATE) * closeness;
  return shiftType === "instant" ? Math.max(PENALTY_INSTANT_BASE, scheduled) : scheduled;
};

/**
 * @typedef {Object} HiredWorker
 * @property {string} workerProfileId
 * @property {string} userId
 * @property {string|null} [fullName]
 * @property {number|string|null} reliabilityScore
 * @property {Date|null} hiredAt        when the worker was hired (assignment created)
 * @property {boolean} checkedIn        whether the worker checked in (affects expiry)
 */

/**
 * Decides the cancellation outcome for a shift and, when a penalty applies,
 * computes each hired worker's penalty rate + factor breakdown.
 *
 * @param {Object} input
 * @param {Date} input.now
 * @param {string} input.shiftType            instant | scheduled | prebooked
 * @param {Date} input.startAt                composed shift start datetime
 * @param {Date} input.endAt                  composed shift end datetime
 * @param {number} input.workersNeeded
 * @param {number} input.applicantCount       active applicants (demand signal)
 * @param {number|string|null} input.businessReliabilityScore
 * @param {HiredWorker[]} input.hired
 * @returns {{ free: boolean, penalty_applies: boolean, reason: string, is_expired: boolean,
 *   hours_to_start: number, shift_factors: object|null,
 *   per_worker: Array<{ worker_profile_id: string, user_id: string, full_name: string|null, rate: number, factors: object }> }}
 */
export const computeCancellation = ({
  now,
  shiftType,
  startAt,
  endAt,
  workersNeeded,
  applicantCount,
  businessReliabilityScore,
  hired,
}) => {
  const hoursToStart = (startAt.getTime() - now.getTime()) / HOUR_MS;
  // Expired = the shift window has passed and nobody ever checked in (a dead post).
  const isExpired = endAt.getTime() < now.getTime() && hired.every((w) => !w.checkedIn);

  // Free-cancel gates (no compensation owed).
  let reason = "penalty";
  if (hired.length === 0) reason = "no_workers_hired";
  else if (isExpired) reason = "shift_expired";
  else if (shiftType !== "instant" && hoursToStart > CANCEL_FREE_NOTICE_HOURS) reason = "outside_notice_window";

  if (reason !== "penalty") {
    return {
      free: true,
      penalty_applies: false,
      reason,
      is_expired: isExpired,
      hours_to_start: round(hoursToStart, 2),
      shift_factors: null,
      per_worker: [],
    };
  }

  // Shift-level factors (identical for every hired worker on this shift).
  const base = timingBase(shiftType, hoursToStart);
  const businessAdj = PENALTY_FACTOR_WEIGHT * (1 - reliabilityNorm(businessReliabilityScore));
  const demandRatio = workersNeeded > 0 ? applicantCount / workersNeeded : 0;
  const demandAdj = PENALTY_FACTOR_WEIGHT * clamp01(demandRatio / PENALTY_DEMAND_SATURATION_RATIO);

  const per_worker = hired.map((w) => {
    const hoursSinceHired = w.hiredAt ? (now.getTime() - w.hiredAt.getTime()) / HOUR_MS : 0;
    const durationAdj = PENALTY_FACTOR_WEIGHT * clamp01(hoursSinceHired / PENALTY_DURATION_SATURATION_HOURS);
    const workerAdj = PENALTY_FACTOR_WEIGHT * reliabilityNorm(w.reliabilityScore);
    const rate = clamp(base + durationAdj + workerAdj + businessAdj + demandAdj, PENALTY_MIN_RATE, PENALTY_MAX_RATE);
    return {
      worker_profile_id: w.workerProfileId,
      user_id: w.userId,
      full_name: w.fullName ?? null,
      rate: round(rate, 4),
      factors: {
        base: round(base, 4),
        duration: round(durationAdj, 4),
        worker_reliability: round(workerAdj, 4),
        business_reliability: round(businessAdj, 4),
        demand: round(demandAdj, 4),
      },
    };
  });

  return {
    free: false,
    penalty_applies: true,
    reason: "penalty",
    is_expired: false,
    hours_to_start: round(hoursToStart, 2),
    shift_factors: {
      base: round(base, 4),
      business_reliability: round(businessAdj, 4),
      demand: round(demandAdj, 4),
    },
    per_worker,
  };
};
