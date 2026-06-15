import { validationResult } from "express-validator";
import { sendSuccess, sendError } from "../../utils/response.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as authService from "./auth.service.js";

export const sendOtp = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const { phone, purpose } = req.body;

  await authService.sendOtp(phone, purpose);
  return sendSuccess(res, 200, "OTP sent successfully");
});

export const verifyOtp = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const { phone, otp_code, purpose, role } = req.body;
  const meta = { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
  const result = await authService.verifyOtpAndAuthenticate(phone, otp_code, purpose, role, meta);
  return sendSuccess(res, 200, "Authentication successful", result);
});

export const refreshToken = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const { refresh_token } = req.body;
  const result = await authService.refreshAccessToken(refresh_token);
  // result contains both accessToken and new refreshToken (rotation)
  return sendSuccess(res, 200, "Token refreshed", result);
});

export const getMe = asyncHandler(async (req, res) => {
  const user = await authService.getMe(req.user.id);
  return sendSuccess(res, 200, "Authenticated", user);
});

export const logout = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const { refresh_token } = req.body;
  await authService.logout(refresh_token);
  return sendSuccess(res, 200, "Logged out successfully");
});
