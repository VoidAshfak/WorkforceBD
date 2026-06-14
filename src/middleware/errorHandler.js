import { sendError } from "../utils/response.js";

/**
 * Global error handling middleware.
 * @type {import("express").ErrorRequestHandler}
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  console.error(err);

  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    return sendError(res, 401, "Invalid or expired token");
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal server error";
  return sendError(res, statusCode, message);
};

export default errorHandler;
