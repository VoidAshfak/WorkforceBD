import { Router } from "express";
import * as authController from "./auth.controller.js";
import authenticate from "../../middleware/authenticate.js";
import { otpSendLimiter, otpVerifyLimiter } from "../../middleware/rateLimiter.js";
import {
  sendOtpRules,
  verifyOtpRules,
  refreshTokenRules,
  logoutRules,
} from "./auth.validation.js";

const router = Router();

router.get("/me", authenticate, authController.getMe);
router.post("/send-otp", otpSendLimiter, sendOtpRules, authController.sendOtp);
router.post("/verify-otp", otpVerifyLimiter, verifyOtpRules, authController.verifyOtp);
router.post("/refresh", refreshTokenRules, authController.refreshToken);
router.post("/logout", logoutRules, authController.logout);

export default router;
