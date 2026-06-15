/**
 * Wraps async route handlers — forwards rejections to Express error middleware.
 * Eliminates try/catch boilerplate in every controller.
 * @param {import("express").RequestHandler} fn
 * @returns {import("express").RequestHandler}
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
