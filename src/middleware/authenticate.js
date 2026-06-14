import { verifyAccessToken } from "../utils/token.js";
import { sendError } from "../utils/response.js";

/**
 * Verifies JWT access token and attaches decoded user to req.user.
 * @type {import("express").RequestHandler}
 */
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return sendError(res, 401, "Authorization token required");
  }

  const token = authHeader.split(" ")[1];
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch (err) {
    next(err);
  }
};

export default authenticate;
