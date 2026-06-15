import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
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
 * @returns {string}
 */
export const generateRefreshToken = () => {
  return randomBytes(32).toString("hex");
};

/**
 * @param {string} token
 * @returns {{ id: string, roles: string[] }}
 */
export const verifyAccessToken = (token) => {
  return jwt.verify(token, env.jwtSecret);
};
