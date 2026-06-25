import crypto from "node:crypto";
import { CHECKIN_QR_STEP_SECONDS } from "../constants.js";

// One-window clock-skew/scan-lag tolerance on each side of the current window.
const SKEW_WINDOWS = 1;

/**
 * Current rotating time window index for a shift's QR code.
 * @param {number} [nowMs]
 */
const windowIndex = (nowMs = Date.now()) =>
  Math.floor(nowMs / 1000 / CHECKIN_QR_STEP_SECONDS);

/**
 * Derives the short-lived check-in code for a given window. The shift's
 * `checkin_qr_token` is the per-shift secret and never leaves the server; only
 * this rotating derivative is shown on-site, so a leaked/old code expires fast.
 * @param {string} secret  shift.checkin_qr_token
 * @param {string} shiftId
 * @param {number} window
 * @returns {string} 10-char hex code (40 bits)
 */
const codeForWindow = (secret, shiftId, window) =>
  crypto
    .createHmac("sha256", secret)
    .update(`${shiftId}:${window}`)
    .digest("hex")
    .slice(0, 10);

/**
 * The check-in code to display right now, plus seconds until it rotates.
 * @param {string} secret
 * @param {string} shiftId
 * @returns {{ code: string, expires_in: number }}
 */
export const currentCheckinCode = (secret, shiftId) => {
  const now = Date.now();
  const window = windowIndex(now);
  const nextRotationMs = (window + 1) * CHECKIN_QR_STEP_SECONDS * 1000;
  return {
    code: codeForWindow(secret, shiftId, window),
    expires_in: Math.ceil((nextRotationMs - now) / 1000),
  };
};

/**
 * Constant-time check of a worker-supplied code against the current window
 * (± skew tolerance), so a code captured one cycle ago still validates briefly.
 * @param {string} secret
 * @param {string} shiftId
 * @param {string} code
 * @returns {boolean}
 */
export const verifyCheckinCode = (secret, shiftId, code) => {
  if (typeof code !== "string") return false;
  const current = windowIndex();
  for (let w = current - SKEW_WINDOWS; w <= current + SKEW_WINDOWS; w++) {
    const expected = codeForWindow(secret, shiftId, w);
    const a = Buffer.from(expected);
    const b = Buffer.from(code);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
};
