import jwt from "jsonwebtoken";
import { randomBytes, createHash } from "crypto";
import { env } from "../config/env.js";

/**
 * @param {{ id: string, roles: string[] }} payload
 * @returns {string}
 */
export const generateAccessToken = (payload) => {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtAccessExpiresIn });
};

/**
 * Cryptographically random opaque token — expiry enforced via DB.
 * The raw value is returned to the client once; only its hash is persisted.
 * @returns {string}
 */
export const generateRefreshToken = () => {
  return randomBytes(32).toString("hex");
};

/**
 * Hashes a refresh token for storage/lookup at rest. A DB leak then exposes
 * only digests, not usable tokens.
 * @param {string} token
 * @returns {string} 64-char hex digest
 */
export const hashRefreshToken = (token) => createHash("sha256").update(token).digest("hex");

/**
 * @param {string} token
 * @returns {{ id: string, roles: string[] }}
 */
export const verifyAccessToken = (token) => {
  return jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] });
};
