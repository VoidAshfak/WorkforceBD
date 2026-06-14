import { sendError } from "../utils/response.js";

/**
 * Role-based access guard. Use after `authenticate`.
 * @param {...string} roles - allowed roles, e.g. authorize("admin"), authorize("worker", "business")
 * @returns {import("express").RequestHandler}
 */
const authorize = (...roles) => (req, res, next) => {
  const userRoles = req.user?.roles ?? [];
  const hasRole = roles.some((r) => userRoles.includes(r));
  if (!hasRole) return sendError(res, 403, "You do not have permission to access this resource");
  next();
};

export default authorize;
