import morgan from "morgan";
import { env } from "./env.js";

/**
 * HTTP request logger middleware.
 * Uses "dev" format in development, "combined" in production.
 */
export const httpLogger = morgan(env.nodeEnv === "production" ? "combined" : "dev");

/**
 * Minimal app-level logger. Use instead of raw console.log.
 */
export const logger = {
  info: (...args) => console.log("[INFO]", ...args),
  warn: (...args) => console.warn("[WARN]", ...args),
  error: (...args) => console.error("[ERROR]", ...args),
  debug: (...args) => {
    if (env.nodeEnv !== "production") console.log("[DEBUG]", ...args);
  },
};
