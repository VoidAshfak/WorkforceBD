import { body, query, param } from "express-validator";

export const applyRules = [
  body("shift_id").notEmpty().isUUID().withMessage("shift_id is required and must be a UUID"),
  body("note").optional().isString().isLength({ max: 500 }).withMessage("note must be under 500 chars"),
];

export const listApplicationsRules = [
  query("status")
    .optional()
    .isIn(["pending", "shortlisted", "accepted", "rejected", "withdrawn", "no_show"])
    .withMessage("Invalid status"),
  query("page").optional().isInt({ min: 1 }).toInt().withMessage("page must be a positive integer"),
  query("limit").optional().isInt({ min: 1, max: 50 }).toInt().withMessage("limit must be 1–50"),
];

export const applicationIdRules = [
  param("id").isUUID().withMessage("Invalid application id"),
];
