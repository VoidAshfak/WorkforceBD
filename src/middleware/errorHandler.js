import { logger } from "../config/logger.js";
import { sendError } from "../utils/response.js";

/**
 * Global error handler.
 * Operational errors (AppError) → warn log, expose message.
 * Programming errors (unexpected) → error log, hide message in production.
 * @type {import("express").ErrorRequestHandler}
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  if (err.isOperational) {
    logger.warn(`[${err.statusCode}] ${req.method} ${req.originalUrl} — ${err.message}`);
  } else {
    logger.error(`UNEXPECTED | ${req.method} ${req.originalUrl} — ${err.message}`, err.stack);
  }

  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    return sendError(res, 401, "Invalid or expired token");
  }

  const statusCode = err.statusCode || 500;
  const message = err.isOperational ? err.message : "Internal server error";
  // Operational errors may attach a structured payload (e.g. a penalty breakdown).
  return sendError(res, statusCode, message, err.isOperational ? err.details : undefined);
};

export default errorHandler;
