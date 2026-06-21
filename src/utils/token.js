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

// Audience claim scoping a ticket to the Socket.IO handshake only — a leaked
// ticket can't be used as a REST access token (different aud) and vice versa.
const SOCKET_TICKET_AUDIENCE = "socket";

/**
 * Mints a short-lived, single-purpose credential for the Socket.IO handshake.
 * Carries only the subject (userId) and a `socket` audience — it can't call the
 * REST API and can't be refreshed. Expiry is the only thing keeping it safe, so
 * keep it short (see env.socketTicketExpiresIn).
 * @param {string} userId
 * @returns {string}
 */
export const generateSocketTicket = (userId) => {
  return jwt.sign({}, env.jwtSecret, {
    subject: userId,
    audience: SOCKET_TICKET_AUDIENCE,
    expiresIn: env.socketTicketExpiresIn,
  });
};

/**
 * Verifies a socket ticket. Rejects anything that isn't a `socket`-audience
 * token (e.g. a raw access token) or is expired.
 * @param {string} token
 * @returns {{ id: string }} the authenticated user
 */
export const verifySocketTicket = (token) => {
  const decoded = jwt.verify(token, env.jwtSecret, {
    algorithms: ["HS256"],
    audience: SOCKET_TICKET_AUDIENCE,
  });
  return { id: decoded.sub };
};
