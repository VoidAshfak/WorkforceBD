import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

/**
 * @param {{ id: string, roles: string[] }} payload
 * @returns {string}
 */
export const generateAccessToken = (payload) => {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtAccessExpiresIn });
};

/**
 * @returns {string}
 */
export const generateRefreshToken = () => {
  return jwt.sign({ rand: Math.random() }, env.jwtSecret, {
    expiresIn: env.jwtRefreshExpiresIn,
  });
};

/**
 * @param {string} token
 * @returns {{ id: string, roles: string[] }}
 */
export const verifyAccessToken = (token) => {
  return jwt.verify(token, env.jwtSecret);
};
