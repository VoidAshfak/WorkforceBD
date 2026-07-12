import { body, query, param } from "express-validator";

const VERIFICATION_STATUSES = ["unverified", "pending", "verified", "rejected"];

export const listVerificationsRules = [
  query("type").optional().isIn(["worker", "business"]).withMessage("type must be 'worker' or 'business'"),
  query("status").optional().isIn(VERIFICATION_STATUSES).withMessage("Invalid status"),
  query("page").optional().isInt({ min: 1 }).toInt().withMessage("page must be a positive integer"),
  query("limit").optional().isInt({ min: 1, max: 50 }).toInt().withMessage("limit must be 1–50"),
];

export const getVerificationRules = [
  param("profileId").isUUID().withMessage("Invalid profile id"),
  query("type").notEmpty().isIn(["worker", "business"]).withMessage("type query is required ('worker' or 'business')"),
];

export const decideVerificationRules = [
  param("profileId").isUUID().withMessage("Invalid profile id"),
  body("type").notEmpty().isIn(["worker", "business"]).withMessage("type is required ('worker' or 'business')"),
  body("decision").notEmpty().isIn(["approve", "reject"]).withMessage("decision must be 'approve' or 'reject'"),
  // a rejection must explain why
  body("note")
    .if(body("decision").equals("reject"))
    .trim()
    .notEmpty().withMessage("note is required when rejecting")
    .bail()
    .isLength({ max: 500 }).withMessage("note must be under 500 chars"),
  body("note")
    .if(body("decision").equals("approve"))
    .optional()
    .isLength({ max: 500 }).withMessage("note must be under 500 chars"),
];

export const listShiftPostsRules = [
  query("status").optional().isIn(["pending_approval", "published", "draft"]).withMessage("Invalid status"),
  query("page").optional().isInt({ min: 1 }).toInt().withMessage("page must be a positive integer"),
  query("limit").optional().isInt({ min: 1, max: 50 }).toInt().withMessage("limit must be 1–50"),
];

export const decideShiftPostRules = [
  param("shiftId").isUUID().withMessage("Invalid shift id"),
  body("decision").notEmpty().isIn(["approve", "reject"]).withMessage("decision must be 'approve' or 'reject'"),
  body("note")
    .if(body("decision").equals("reject"))
    .trim()
    .notEmpty().withMessage("note is required when rejecting")
    .bail()
    .isLength({ max: 500 }).withMessage("note must be under 500 chars"),
];

export const analyticsRules = [
  query("days").optional().isInt({ min: 7, max: 90 }).toInt().withMessage("days must be 7–90"),
];

export const listUsersRules = [
  query("role").optional().isIn(["worker", "business", "admin"]).withMessage("role must be 'worker', 'business' or 'admin'"),
  query("status").optional().isIn(["active", "blocked"]).withMessage("status must be 'active' or 'blocked'"),
  query("search").optional().trim().isLength({ max: 100 }).withMessage("search must be under 100 chars"),
  query("page").optional().isInt({ min: 1 }).toInt().withMessage("page must be a positive integer"),
  query("limit").optional().isInt({ min: 1, max: 50 }).toInt().withMessage("limit must be 1–50"),
];

export const userIdRules = [
  param("userId").isUUID().withMessage("Invalid user id"),
];

export const blockUserRules = [
  param("userId").isUUID().withMessage("Invalid user id"),
  body("reason")
    .trim()
    .notEmpty().withMessage("reason is required")
    .bail()
    .isLength({ max: 500 }).withMessage("reason must be under 500 chars"),
  body("severity").optional().isIn(["low", "medium", "high", "critical"]).withMessage("Invalid severity"),
];

export const unblockUserRules = [
  param("userId").isUUID().withMessage("Invalid user id"),
  body("note").optional().trim().isLength({ max: 500 }).withMessage("note must be under 500 chars"),
];

export const updateSettingRules = [
  param("key").trim().notEmpty().withMessage("Setting key is required"),
  body("value").isNumeric().withMessage("value must be a number").toFloat(),
];

export const settingKeyRules = [
  param("key").trim().notEmpty().withMessage("Setting key is required"),
];
