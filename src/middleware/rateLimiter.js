import { rateLimit } from "express-rate-limit";

/**
 * 3 OTP requests per phone per 10 minutes.
 * Key is phone from body — prevents targeting a specific number.
 */
export const otpSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 3,
  keyGenerator: (req) => req.body?.phone || req.ip,
  message: { success: false, message: "Too many OTP requests. Try again in 10 minutes." },
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

/**
 * 5 verify attempts per IP per 15 minutes.
 * Prevents brute-forcing the 6-digit OTP (1M combinations).
 */
export const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => req.ip,
  message: { success: false, message: "Too many failed attempts. Try again in 15 minutes." },
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
