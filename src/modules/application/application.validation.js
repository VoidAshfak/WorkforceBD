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

export const checkInRules = [
  param("id").isUUID().withMessage("Invalid application id"),
  body("method").isIn(["gps", "qr", "manual"]).withMessage("method must be one of: gps, qr, manual"),
  body("coordinates")
    .if(body("method").equals("gps"))
    .notEmpty().withMessage("coordinates are required for GPS check-in"),
  body("coordinates.latitude")
    .if(body("method").equals("gps"))
    .isFloat({ min: -90, max: 90 }).withMessage("latitude must be between -90 and 90"),
  body("coordinates.longitude")
    .if(body("method").equals("gps"))
    .isFloat({ min: -180, max: 180 }).withMessage("longitude must be between -180 and 180"),
  body("qr_token")
    .if(body("method").equals("qr"))
    .isUUID().withMessage("qr_token must be a valid QR token"),
];
