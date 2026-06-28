import { body, param, query } from "express-validator";
import { BUSINESS_TOPUP_METHODS } from "../../constants.js";

const TIME_24H = /^([01]\d|2[0-3]):([0-5]\d)$/;
const SHIFT_TYPES = ["instant", "scheduled", "prebooked"];
const GENDERS = ["male", "female", "other", "prefer_not_to_say"];
const SHIFT_STATUSES = [
  "draft", "published", "applications_open", "worker_selected", "worker_confirmed",
  "worker_arriving", "checked_in", "active", "completed", "payment_pending", "paid", "closed", "cancelled",
];
const APPLICATION_STATUSES = ["pending", "shortlisted", "accepted", "rejected", "withdrawn", "no_show"];

/* ----------------------------- Profile ----------------------------- */

export const createProfileRules = [
  body("business_name").trim().notEmpty().withMessage("Business name is required").isLength({ max: 200 }),
  body("business_type").optional().trim().isLength({ max: 100 }),
  body("manager_name").optional().trim().isLength({ max: 100 }),
  body("manager_phone")
    .optional()
    .matches(/^(\+8801)[3-9]{1}[0-9]{8}$/).withMessage("Invalid manager phone number"),
  body("logo_url").optional().isURL().withMessage("logo_url must be a valid URL"),
];

export const locationRules = [
  body("zone_id").optional().isUUID().withMessage("zone_id must be a valid UUID"),
  body("address").optional().trim().isLength({ max: 500 }),
  body("landmark").optional().trim().isLength({ max: 200 }),
];

export const documentsRules = [
  body("trade_license_url").optional().isURL().withMessage("trade_license_url must be a valid URL"),
  body("business_doc_url").optional().isURL().withMessage("business_doc_url must be a valid URL"),
];

export const preferencesRules = [
  body("meal_included").optional().isBoolean().withMessage("meal_included must be a boolean"),
  body("transport_support").optional().isBoolean().withMessage("transport_support must be a boolean"),
  body("female_friendly").optional().isBoolean().withMessage("female_friendly must be a boolean"),
  body("uniform_required").optional().isBoolean().withMessage("uniform_required must be a boolean"),
];

/* ------------------------------ Shifts ----------------------------- */

export const createShiftRules = [
  body("title").trim().notEmpty().withMessage("Shift title is required").isLength({ max: 200 }),
  body("description").optional().trim(),
  body("category_id").notEmpty().withMessage("category_id is required").isUUID().withMessage("category_id must be a valid UUID"),
  body("role_type").optional().trim().isLength({ max: 100 }),
  body("shift_type").notEmpty().isIn(SHIFT_TYPES).withMessage(`shift_type must be one of: ${SHIFT_TYPES.join(", ")}`),
  body("shift_date").notEmpty().isDate({ format: "YYYY-MM-DD" }).withMessage("shift_date must be YYYY-MM-DD"),
  body("start_time").notEmpty().matches(TIME_24H).withMessage("start_time must be HH:MM (24h)"),
  body("end_time").notEmpty().matches(TIME_24H).withMessage("end_time must be HH:MM (24h)"),
  body("pay_amount").notEmpty().isFloat({ gt: 0 }).withMessage("pay_amount must be greater than 0"),
  body("workers_needed").notEmpty().isInt({ min: 1, max: 1000 }).withMessage("workers_needed must be at least 1"),
  body("gender_preference").optional().isIn(GENDERS).withMessage("Invalid gender_preference"),
  body("meal_included").optional().isBoolean(),
  body("transport_support").optional().isBoolean(),
  body("zone_id").optional().isUUID().withMessage("zone_id must be a valid UUID"),
  body("address").optional().trim().isLength({ max: 500 }),
  body("landmark").optional().trim().isLength({ max: 200 }),
  body("draft").optional().isBoolean().withMessage("draft must be a boolean"),
];

export const updateShiftRules = [
  param("id").isUUID().withMessage("Invalid shift id"),
  body("title").optional().trim().notEmpty().isLength({ max: 200 }),
  body("description").optional().trim(),
  body("category_id").optional().isUUID().withMessage("category_id must be a valid UUID"),
  body("role_type").optional().trim().isLength({ max: 100 }),
  body("shift_type").optional().isIn(SHIFT_TYPES).withMessage(`shift_type must be one of: ${SHIFT_TYPES.join(", ")}`),
  body("shift_date").optional().isDate({ format: "YYYY-MM-DD" }).withMessage("shift_date must be YYYY-MM-DD"),
  body("start_time").optional().matches(TIME_24H).withMessage("start_time must be HH:MM (24h)"),
  body("end_time").optional().matches(TIME_24H).withMessage("end_time must be HH:MM (24h)"),
  body("pay_amount").optional().isFloat({ gt: 0 }).withMessage("pay_amount must be greater than 0"),
  body("workers_needed").optional().isInt({ min: 1, max: 1000 }).withMessage("workers_needed must be at least 1"),
  body("gender_preference").optional().isIn(GENDERS).withMessage("Invalid gender_preference"),
  body("meal_included").optional().isBoolean(),
  body("transport_support").optional().isBoolean(),
  body("zone_id").optional().isUUID().withMessage("zone_id must be a valid UUID"),
  body("address").optional().trim().isLength({ max: 500 }),
  body("landmark").optional().trim().isLength({ max: 200 }),
];

export const listShiftsRules = [
  query("status").optional().isIn(SHIFT_STATUSES).withMessage("Invalid status filter"),
  query("page").optional().isInt({ min: 1 }),
  query("limit").optional().isInt({ min: 1, max: 50 }),
];

export const shiftIdRules = [param("id").isUUID().withMessage("Invalid shift id")];

export const cancelShiftRules = [
  param("id").isUUID().withMessage("Invalid shift id"),
  body("reason").trim().notEmpty().withMessage("Cancellation reason is required").isLength({ max: 500 }),
];

/* ------------------------------ Wallet ----------------------------- */

export const topUpRules = [
  body("amount").notEmpty().isFloat({ gt: 0 }).withMessage("amount must be greater than 0"),
  body("method").optional().isIn(BUSINESS_TOPUP_METHODS).withMessage(`method must be one of: ${BUSINESS_TOPUP_METHODS.join(", ")}`),
];

/* ---------------------------- Applicants ---------------------------- */

export const listApplicantsRules = [
  param("id").isUUID().withMessage("Invalid shift id"),
  query("status").optional().isIn(APPLICATION_STATUSES).withMessage("Invalid status filter"),
  query("page").optional().isInt({ min: 1 }),
  query("limit").optional().isInt({ min: 1, max: 50 }),
];

export const applicationIdRules = [param("id").isUUID().withMessage("Invalid application id")];
