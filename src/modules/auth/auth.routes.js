import { Router } from "express";
import * as authController from "./auth.controller.js";
import {
  sendOtpRules,
  verifyOtpRules,
  refreshTokenRules,
  logoutRules,
} from "./auth.validation.js";

const router = Router();

router.post("/send-otp", sendOtpRules, authController.sendOtp);
router.post("/verify-otp", verifyOtpRules, authController.verifyOtp);
router.post("/refresh", refreshTokenRules, authController.refreshToken);
router.post("/logout", logoutRules, authController.logout);

export default router;
