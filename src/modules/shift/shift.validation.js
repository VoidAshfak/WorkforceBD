import { query, param } from "express-validator";

export const listShiftsRules = [
  query("filter")
    .optional()
    .isIn(["all", "nearby", "urgent", "high_pay"]).withMessage("Invalid filter"),
  query("zone_id").optional().isUUID().withMessage("zone_id must be a valid UUID"),
  query("category_id").optional().isUUID().withMessage("category_id must be a valid UUID"),
  query("page").optional().isInt({ min: 1 }).toInt().withMessage("page must be a positive integer"),
  query("limit").optional().isInt({ min: 1, max: 50 }).toInt().withMessage("limit must be 1–50"),
];

export const shiftIdRules = [
  param("id").isUUID().withMessage("Invalid shift id"),
];
