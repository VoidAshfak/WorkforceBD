import { body } from "express-validator";

export const sendOtpRules = [
  body("phone")
    .trim()
    .notEmpty().withMessage("Phone is required")
    .matches(/^(\+8801)[3-9]{1}[0-9]{8}$/).withMessage("Invalid phone number"),
];

export const verifyOtpRules = [
  body("phone")
    .trim()
    .notEmpty().withMessage("Phone is required")
    .matches(/^(\+8801)[3-9]{1}[0-9]{8}$/).withMessage("Invalid phone number"),
  body("otp_code")
    .trim()
    .notEmpty().withMessage("OTP is required")
    .isLength({ min: 6, max: 6 }).withMessage("OTP must be 6 digits")
    .isNumeric().withMessage("OTP must be numeric"),
  // Role chosen on the first screen. Optional for returning users, but required
  // by the service when the phone has no account yet.
  body("role")
    .optional()
    .isIn(["worker", "business"]).withMessage("Role must be 'worker' or 'business'"),
];

export const refreshTokenRules = [
  body("refresh_token").trim().notEmpty().withMessage("Refresh token is required"),
];

export const logoutRules = [
  body("refresh_token").trim().notEmpty().withMessage("Refresh token is required"),
];
