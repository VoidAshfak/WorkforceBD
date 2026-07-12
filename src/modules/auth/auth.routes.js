import { Router } from "express";
import * as authController from "./auth.controller.js";
import authenticate from "../../middleware/authenticate.js";
import { otpSendLimiter, otpVerifyLimiter, adminAuthLimiter } from "../../middleware/rateLimiter.js";
import {
  sendOtpRules,
  verifyOtpRules,
  switchRoleRules,
  refreshTokenRules,
  logoutRules,
  adminLoginRules,
  adminVerify2faRules,
} from "./auth.validation.js";

const router = Router();

router.get("/me", authenticate, authController.getMe);
router.post("/send-otp", otpSendLimiter, sendOtpRules, authController.sendOtp);
router.post("/verify-otp", otpVerifyLimiter, verifyOtpRules, authController.verifyOtp);
router.post("/switch-role", authenticate, switchRoleRules, authController.switchRole);

// Admin portal — username + password, then a 2FA code mailed to the admin's Gmail
router.post("/admin/login", adminAuthLimiter, adminLoginRules, authController.adminLogin);
router.post("/admin/verify-2fa", adminAuthLimiter, adminVerify2faRules, authController.adminVerify2fa);
router.post("/refresh", refreshTokenRules, authController.refreshToken);
router.post("/logout", logoutRules, authController.logout);

export default router;
