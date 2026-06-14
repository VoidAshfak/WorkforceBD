import { validationResult } from "express-validator";
import { sendSuccess, sendError } from "../../utils/response.js";
import * as authService from "./auth.service.js";

/** @param {import("express").Request} req @param {import("express").Response} res @param {import("express").NextFunction} next */
export const sendOtp = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

    const { phone, purpose } = req.body;
    await authService.sendOtp(phone, purpose);
    return sendSuccess(res, 200, "OTP sent successfully");
  } catch (err) {
    next(err);
  }
};

/** @param {import("express").Request} req @param {import("express").Response} res @param {import("express").NextFunction} next */
export const verifyOtp = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

    const { phone, otp_code, purpose, role } = req.body;
    const meta = { ipAddress: req.ip, userAgent: req.headers["user-agent"] };

    const result = await authService.verifyOtpAndAuthenticate(phone, otp_code, purpose, role, meta);
    return sendSuccess(res, 200, "Authentication successful", result);
  } catch (err) {
    next(err);
  }
};

/** @param {import("express").Request} req @param {import("express").Response} res @param {import("express").NextFunction} next */
export const refreshToken = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

    const { refresh_token } = req.body;
    const result = await authService.refreshAccessToken(refresh_token);
    return sendSuccess(res, 200, "Token refreshed", result);
  } catch (err) {
    next(err);
  }
};

/** @param {import("express").Request} req @param {import("express").Response} res @param {import("express").NextFunction} next */
export const logout = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

    const { refresh_token } = req.body;
    await authService.logout(refresh_token);
    return sendSuccess(res, 200, "Logged out successfully");
  } catch (err) {
    next(err);
  }
};
