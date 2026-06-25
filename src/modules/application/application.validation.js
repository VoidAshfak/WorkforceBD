import { body, query, param } from "express-validator";
import { WORKER_CHECKIN_METHODS } from "../../constants.js";

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

// Both check-in methods require coordinates: GPS proves presence directly, and
// QR additionally enforces the geofence so a relayed code can't be used off-site.
const requiresCoordinates = body("method").isIn(["gps", "qr"]);

export const checkInRules = [
  param("id").isUUID().withMessage("Invalid application id"),
  body("method")
    .isIn(WORKER_CHECKIN_METHODS)
    .withMessage(`method must be one of: ${WORKER_CHECKIN_METHODS.join(", ")}`),
  body("coordinates")
    .if(requiresCoordinates)
    .notEmpty().withMessage("coordinates are required to check in"),
  body("coordinates.latitude")
    .if(requiresCoordinates)
    .isFloat({ min: -90, max: 90 }).withMessage("latitude must be between -90 and 90"),
  body("coordinates.longitude")
    .if(requiresCoordinates)
    .isFloat({ min: -180, max: 180 }).withMessage("longitude must be between -180 and 180"),
  body("coordinates.accuracy")
    .optional()
    .isFloat({ min: 0 }).withMessage("accuracy must be a positive number of metres"),
  body("qr_token")
    .if(body("method").equals("qr"))
    .notEmpty().withMessage("qr_token is required for QR check-in").bail()
    .isString().isLength({ min: 8, max: 64 }).withMessage("qr_token must be a valid check-in code"),
];
