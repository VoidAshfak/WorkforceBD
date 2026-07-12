import { validationResult } from "express-validator";
import { sendSuccess, sendError } from "../../utils/response.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as authService from "./auth.service.js";
import { env } from "../../config/env.js";

// Admin refresh token travels in an httpOnly session cookie (no Expires →
// browser discards it when the browser closes). Page scripts can never read it.
const ADMIN_REFRESH_COOKIE = "admin_refresh_token";
const adminCookieOptions = () => ({
  httpOnly: true,
  secure: env.nodeEnv === "production",
  sameSite: "strict",
  path: "/api/v1/auth", // only sent to auth endpoints (refresh/logout)
});

export const sendOtp = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const { phone } = req.body;

  await authService.sendOtp(phone);
  return sendSuccess(res, 200, "OTP sent successfully");
});

export const verifyOtp = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const { phone, otp_code, role } = req.body;
  const meta = { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
  const result = await authService.verifyOtpAndAuthenticate(phone, otp_code, role, meta);
  return sendSuccess(res, 200, "Authentication successful", result);
});

export const adminLogin = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const { username, password } = req.body;
  const result = await authService.adminLogin(username, password);
  return sendSuccess(res, 200, "Verification code sent to your email", result);
});

export const adminVerify2fa = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const { username, code } = req.body;
  const meta = { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
  const { refreshToken, ...result } = await authService.adminVerify2fa(username, code, meta);
  // Refresh token goes only in the cookie — never in the JSON body.
  res.cookie(ADMIN_REFRESH_COOKIE, refreshToken, adminCookieOptions());
  return sendSuccess(res, 200, "Admin authentication successful", result);
});

export const refreshToken = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  // Body token (worker/business apps) or admin cookie — cookie wins if body empty.
  const token = req.body.refresh_token || req.cookies?.[ADMIN_REFRESH_COOKIE];
  if (!token) return sendError(res, 422, "Validation failed", [{ msg: "Refresh token is required" }]);

  const { active_role, ...result } = await authService.refreshAccessToken(token);
  if (active_role === "admin") {
    // Rotate the cookie; keep the new refresh token out of the JSON body.
    res.cookie(ADMIN_REFRESH_COOKIE, result.refreshToken, adminCookieOptions());
    delete result.refreshToken;
  }
  return sendSuccess(res, 200, "Token refreshed", result);
});

export const getMe = asyncHandler(async (req, res) => {
  const user = await authService.getMe(req.user.id);
  return sendSuccess(res, 200, "Authenticated", user);
});

export const switchRole = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const currentAccessToken = req.headers.authorization.split(" ")[1];
  const result = await authService.switchRole(req.user.id, currentAccessToken, req.body.role);
  return sendSuccess(res, 200, `Switched to ${result.active_role} account`, result);
});

export const logout = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const token = req.body.refresh_token || req.cookies?.[ADMIN_REFRESH_COOKIE];
  if (!token) return sendError(res, 422, "Validation failed", [{ msg: "Refresh token is required" }]);

  await authService.logout(token);
  res.clearCookie(ADMIN_REFRESH_COOKIE, adminCookieOptions());
  return sendSuccess(res, 200, "Logged out successfully");
});
