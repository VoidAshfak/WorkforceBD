import { prisma } from "../db/index.js";
import { logger } from "./logger.js";
import * as constants from "../constants.js";

// Runtime-tunable platform constants. Defaults come from src/constants.js;
// a platform_settings row overrides the default without a redeploy. Admin
// edits go through updateSetting (below), which also refreshes the cache.
// Keys not listed here are NOT tunable (structural values like enum lists,
// timezone offset, and the sweeper interval — that one is read once at boot).
export const SETTING_DEFS = {
  PLATFORM_FEE_PERCENT: { min: 0, max: 50, description: "Platform commission (%) on top of worker pay, escrowed at submit and captured per payout." },
  HANDSHAKE_AUTO_CONFIRM_HOURS: { min: 1, max: 168, description: "Hours the counterparty has to confirm/dispute a checkout before it auto-confirms and pays." },
  CHECKIN_RADIUS_METERS: { min: 20, max: 5000, description: "GPS check-in geofence radius (metres) around the shift location." },
  CHECKIN_GRACE_MINUTES: { min: 0, max: 240, description: "Minutes before shift start a worker may already check in." },
  CHECKIN_MAX_ACCURACY_METERS: { min: 10, max: 1000, description: "Reject GPS check-ins whose reported accuracy is worse than this many metres." },
  BUSINESS_WALLET_SEED_BALANCE: { min: 0, max: 100000, description: "Starting balance (BDT) seeded into a business wallet on first use." },
  MIN_BUSINESS_TOPUP: { min: 1, max: 100000, description: "Smallest single business wallet top-up (BDT)." },
  LARGE_REQUEST_WORKER_THRESHOLD: { min: 1, max: 1000, description: "Shifts requesting more workers than this are flagged for closer admin review." },
  CANCEL_FREE_NOTICE_HOURS: { min: 0, max: 168, description: "Cancelling a scheduled shift earlier than this many hours before start is penalty-free." },
  PENALTY_MIN_RATE: { min: 0, max: 1, description: "Lower clamp on the per-worker cancellation penalty rate (fraction of pay)." },
  PENALTY_MAX_RATE: { min: 0, max: 1, description: "Upper clamp on the per-worker cancellation penalty rate (fraction of pay)." },
  PENALTY_TIMING_MIN_RATE: { min: 0, max: 1, description: "Penalty base rate at the free-notice boundary." },
  PENALTY_TIMING_MAX_RATE: { min: 0, max: 1, description: "Penalty base rate at (or past) the shift start time." },
  PENALTY_INSTANT_BASE: { min: 0, max: 1, description: "Penalty base rate for instant shifts (no notice window)." },
  PENALTY_FACTOR_WEIGHT: { min: 0, max: 0.5, description: "Max upward swing each penalty adjustment factor can add to the base rate." },
};

// Refresh cadence — also picks up rows edited directly in the DB.
const REFRESH_INTERVAL_MS = 60 * 1000;

const cache = new Map();
let refreshTimer = null;

/**
 * Current value of a tunable setting: DB override if present, else the
 * compiled default from constants.js. Synchronous — reads the in-process
 * cache, safe to call from any service after boot.
 * @param {keyof typeof SETTING_DEFS} key
 * @returns {number}
 */
export const setting = (key) => {
  if (!(key in SETTING_DEFS)) throw new Error(`Unknown platform setting: ${key}`);
  return cache.has(key) ? cache.get(key) : constants[key];
};

/** Reloads all overrides from the DB into the cache. */
export const refreshSettings = async () => {
  const rows = await prisma.platform_settings.findMany();
  cache.clear();
  for (const row of rows) {
    if (row.key in SETTING_DEFS && typeof row.value === "number") cache.set(row.key, row.value);
  }
};

/**
 * Loads overrides at boot and starts the periodic refresh (unref'd — doesn't
 * hold the process open). Call once from src/index.js before serving traffic.
 */
export const startSettings = async () => {
  await refreshSettings();
  refreshTimer ??= setInterval(() => {
    refreshSettings().catch((err) => logger.error(`Settings refresh failed: ${err.message}`));
  }, REFRESH_INTERVAL_MS);
  refreshTimer.unref();
  logger.info(`Platform settings loaded | overrides=${cache.size}`);
};

/**
 * Full settings list for the admin panel: every tunable key with its live
 * value, compiled default, bounds, and override metadata.
 */
export const listSettings = async () => {
  const rows = await prisma.platform_settings.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return Object.entries(SETTING_DEFS).map(([key, def]) => {
    const row = byKey.get(key);
    return {
      key,
      value: setting(key),
      default: constants[key],
      is_overridden: Boolean(row),
      min: def.min,
      max: def.max,
      description: def.description,
      updated_at: row?.updated_at ?? null,
      updated_by: row?.updated_by ?? null,
    };
  });
};

/**
 * Validates and persists a setting override, then refreshes the cache so the
 * new value applies immediately (this process) / within one refresh interval
 * (any other process).
 * @param {string} key
 * @param {number} value
 * @param {string} adminId
 */
export const updateSetting = async (key, value, adminId) => {
  const def = SETTING_DEFS[key];
  if (!def) throw new Error(`Unknown platform setting: ${key}`);
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Value must be a number");
  if (value < def.min || value > def.max) throw new Error(`Value must be between ${def.min} and ${def.max}`);

  await prisma.platform_settings.upsert({
    where: { key },
    create: { key, value, description: def.description, updated_by: adminId },
    update: { value, updated_at: new Date(), updated_by: adminId },
  });
  await refreshSettings();
  logger.info(`Platform setting updated | key=${key} value=${value} adminId=${adminId}`);
};

/**
 * Removes an override, reverting the key to its compiled default.
 * @param {string} key
 * @param {string} adminId
 */
export const resetSetting = async (key, adminId) => {
  if (!(key in SETTING_DEFS)) throw new Error(`Unknown platform setting: ${key}`);
  await prisma.platform_settings.deleteMany({ where: { key } });
  await refreshSettings();
  logger.info(`Platform setting reset to default | key=${key} adminId=${adminId}`);
};
