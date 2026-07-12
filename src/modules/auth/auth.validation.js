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

export const switchRoleRules = [
  body("role")
    .trim()
    .notEmpty().withMessage("Role is required")
    .isIn(["worker", "business"]).withMessage("Role must be 'worker' or 'business'"),
];

export const adminLoginRules = [
  body("username")
    .trim()
    .notEmpty().withMessage("Username is required")
    .isLength({ min: 3, max: 50 }).withMessage("Username must be 3-50 characters"),
  body("password")
    .notEmpty().withMessage("Password is required")
    .isLength({ min: 8, max: 128 }).withMessage("Password must be 8-128 characters"),
];

export const adminVerify2faRules = [
  body("username")
    .trim()
    .notEmpty().withMessage("Username is required"),
  body("code")
    .trim()
    .notEmpty().withMessage("Code is required")
    .isLength({ min: 6, max: 6 }).withMessage("Code must be 6 digits")
    .isNumeric().withMessage("Code must be numeric"),
];

// refresh_token may arrive in the body (worker/business) or in the admin
// httpOnly cookie — the controller enforces that at least one is present.
export const refreshTokenRules = [
  body("refresh_token").optional().trim().notEmpty().withMessage("Refresh token must not be empty"),
];

export const logoutRules = [
  body("refresh_token").optional().trim().notEmpty().withMessage("Refresh token must not be empty"),
];
