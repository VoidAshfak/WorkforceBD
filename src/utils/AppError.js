/**
 * Operational error with HTTP status code.
 * isOperational = true  → expected client error, message is safe to expose.
 * isOperational = false → programming bug, hide message in production.
 */
export class AppError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode
   */
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}
