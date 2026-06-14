/**
 * @param {import("express").Response} res
 * @param {number} statusCode
 * @param {string} message
 * @param {*} [data]
 */
export const sendSuccess = (res, statusCode, message, data) => {
  const payload = { success: true, message };
  if (data !== undefined) payload.data = data;
  return res.status(statusCode).json(payload);
};

/**
 * @param {import("express").Response} res
 * @param {number} statusCode
 * @param {string} message
 * @param {*} [errors]
 */
export const sendError = (res, statusCode, message, errors) => {
  const payload = { success: false, message };
  if (errors !== undefined) payload.errors = errors;
  return res.status(statusCode).json(payload);
};
