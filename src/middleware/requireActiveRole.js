import { sendError } from "../utils/response.js";

/**
 * Enforces the caller's ACTIVE account context, not just role membership. A user
 * who holds both `worker` and `business` roles can only hit a worker route while
 * switched to their worker account, and vice versa (see `/auth/switch-role`).
 *
 * Use after `authenticate`. Falls back to role membership for tokens minted
 * before `active_role` existed, so existing sessions keep working until they
 * refresh (within the access-token lifetime).
 *
 * @param {...string} roles - active roles allowed on the route, e.g. requireActiveRole("worker")
 * @returns {import("express").RequestHandler}
 */
const requireActiveRole = (...roles) => (req, res, next) => {
  const activeRole = req.user?.active_role;
  const userRoles = req.user?.roles ?? [];

  // Legacy token without an active_role claim — fall back to membership.
  if (activeRole == null) {
    return roles.some((r) => userRoles.includes(r))
      ? next()
      : sendError(res, 403, "You do not have permission to access this resource");
  }

  if (!roles.includes(activeRole)) {
    return sendError(res, 403, `Switch to your ${roles[0]} account to use this feature`);
  }
  next();
};

export default requireActiveRole;
