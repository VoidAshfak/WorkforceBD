/**
 * Operational error with HTTP status code.
 * isOperational = true  → expected client error, message is safe to expose.
 * isOperational = false → programming bug, hide message in production.
 */
export class AppError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode
   * @param {*} [details] optional structured payload exposed to the client (e.g. a
   *   penalty breakdown on a confirmation-required 409)
   */
  constructor(message, statusCode, details) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    if (details !== undefined) this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}
