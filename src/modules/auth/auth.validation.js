import { body } from "express-validator";

export const sendOtpRules = [
  body("phone")
    .trim()
    .notEmpty().withMessage("Phone is required")
    .matches(/^\+?[0-9]{10,15}$/).withMessage("Invalid phone number"),
  body("purpose")
    .isIn(["login", "register", "verify_phone", "reset"]).withMessage("Invalid purpose"),
  // role required only when registering
  body("role")
    .if(body("purpose").equals("register"))
    .notEmpty().withMessage("Role is required for registration")
    .isIn(["worker", "business"]).withMessage("Role must be 'worker' or 'business'"),
];

export const verifyOtpRules = [
  body("phone")
    .trim()
    .notEmpty().withMessage("Phone is required")
    .matches(/^\+?[0-9]{10,15}$/).withMessage("Invalid phone number"),
  body("otp_code")
    .trim()
    .notEmpty().withMessage("OTP is required")
    .isLength({ min: 6, max: 6 }).withMessage("OTP must be 6 digits")
    .isNumeric().withMessage("OTP must be numeric"),
  body("purpose")
    .isIn(["login", "register"]).withMessage("Invalid purpose"),
  body("role")
    .if(body("purpose").equals("register"))
    .notEmpty().withMessage("Role is required for registration")
    .isIn(["worker", "business"]).withMessage("Role must be 'worker' or 'business'"),
];

export const refreshTokenRules = [
  body("refresh_token").trim().notEmpty().withMessage("Refresh token is required"),
];

export const logoutRules = [
  body("refresh_token").trim().notEmpty().withMessage("Refresh token is required"),
];
