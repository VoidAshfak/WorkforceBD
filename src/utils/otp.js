import { randomInt, createHash } from "crypto";

/**
 * Generates a cryptographically secure 6-digit OTP string.
 * @returns {string}
 */
export const generateOtp = () => String(randomInt(100000, 1000000));

/**
 * Hashes an OTP for storage at rest. OTPs are short-lived and single-use,
 * so a fast SHA-256 digest is sufficient (and is the DB lookup key).
 * @param {string} otp
 * @returns {string} 64-char hex digest
 */
export const hashOtp = (otp) => createHash("sha256").update(otp).digest("hex");
