import { body, param, query } from "express-validator";
import { BUSINESS_TOPUP_METHODS } from "../../constants.js";

const TIME_24H = /^([01]\d|2[0-3]):([0-5]\d)$/;
const SHIFT_TYPES = ["instant", "scheduled", "prebooked"];
const GENDERS = ["male", "female", "other", "prefer_not_to_say"];

// Rejects a shift whose end time is not strictly after its start time (edge
// case: "Invalid Time"). Only fires when both are present (update is partial).
const endAfterStart = (endTime, { req }) => {
  const start = req.body.start_time;
  if (start && endTime && endTime <= start) {
    throw new Error("end_time must be after start_time");
  }
  return true;
};

// Map-pin latitude/longitude must be sent as a pair (or not at all).
const bothOrNeitherCoord = (_value, { req }) => {
  const { latitude, longitude } = req.body;
  if ((latitude == null) !== (longitude == null)) {
    throw new Error("latitude and longitude must be provided together");
  }
  return true;
};

const coordinateRules = (opts) => [
  opts.body("latitude").optional().isFloat({ min: -90, max: 90 }).withMessage("latitude must be between -90 and 90").custom(bothOrNeitherCoord),
  opts.body("longitude").optional().isFloat({ min: -180, max: 180 }).withMessage("longitude must be between -180 and 180").custom(bothOrNeitherCoord),
];

// Requirements/benefits/instructions shared by create + update.
const detailRules = (opts) => [
  opts.body("uniform_provided").optional().isBoolean(),
  opts.body("tips_expected").optional().isBoolean(),
  opts.body("experience_required").optional().isBoolean(),
  opts.body("customer_facing").optional().isBoolean(),
  opts.body("is_urgent").optional().isBoolean(),
  opts.body("languages").optional().isArray({ max: 10 }).withMessage("languages must be an array"),
  opts.body("languages.*").optional().isString().trim().isLength({ min: 1, max: 50 }),
  opts.body("reporting_details").optional().trim().isLength({ max: 1000 }),
  opts.body("dress_code").optional().trim().isLength({ max: 500 }),
  opts.body("manager_contact").optional().trim().isLength({ max: 20 }),
];
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
  body("end_time").notEmpty().matches(TIME_24H).withMessage("end_time must be HH:MM (24h)").custom(endAfterStart),
  body("pay_amount").notEmpty().isFloat({ gt: 0 }).withMessage("pay_amount must be greater than 0"),
  body("workers_needed").notEmpty().isInt({ min: 1, max: 1000 }).withMessage("workers_needed must be at least 1"),
  body("gender_preference").optional().isIn(GENDERS).withMessage("Invalid gender_preference"),
  body("meal_included").optional().isBoolean(),
  body("transport_support").optional().isBoolean(),
  ...detailRules({ body }),
  ...coordinateRules({ body }),
  body("zone_id").optional().isUUID().withMessage("zone_id must be a valid UUID"),
  body("address").optional().trim().isLength({ max: 500 }),
  body("landmark").optional().trim().isLength({ max: 200 }),
  body("draft").optional().isBoolean().withMessage("draft must be a boolean"),
  // Bypass the near-duplicate guard when the business confirms the repeat is intentional.
  body("allow_duplicate").optional().isBoolean().withMessage("allow_duplicate must be a boolean"),
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
  body("end_time").optional().matches(TIME_24H).withMessage("end_time must be HH:MM (24h)").custom(endAfterStart),
  body("pay_amount").optional().isFloat({ gt: 0 }).withMessage("pay_amount must be greater than 0"),
  body("workers_needed").optional().isInt({ min: 1, max: 1000 }).withMessage("workers_needed must be at least 1"),
  body("gender_preference").optional().isIn(GENDERS).withMessage("Invalid gender_preference"),
  body("meal_included").optional().isBoolean(),
  body("transport_support").optional().isBoolean(),
  ...detailRules({ body }),
  ...coordinateRules({ body }),
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

// DELETE /shifts/:id — reason optional; acknowledge_penalty confirms the charge.
export const deleteShiftRules = [
  param("id").isUUID().withMessage("Invalid shift id"),
  body("reason").optional().trim().isLength({ max: 500 }).withMessage("reason must be at most 500 characters"),
  body("acknowledge_penalty").optional().isBoolean().withMessage("acknowledge_penalty must be a boolean").toBoolean(),
];

/* ------------------------------ Wallet ----------------------------- */

export const topUpRules = [
  body("amount").notEmpty().isFloat({ gt: 0 }).withMessage("amount must be greater than 0"),
  body("method").optional().isIn(BUSINESS_TOPUP_METHODS).withMessage(`method must be one of: ${BUSINESS_TOPUP_METHODS.join(", ")}`),
];

export const listWalletTxRules = [
  query("page").optional().isInt({ min: 1 }),
  query("limit").optional().isInt({ min: 1, max: 50 }),
];

/* ---------------------------- Applicants ---------------------------- */

export const listApplicantsRules = [
  param("id").isUUID().withMessage("Invalid shift id"),
  query("status").optional().isIn(APPLICATION_STATUSES).withMessage("Invalid status filter"),
  query("page").optional().isInt({ min: 1 }),
  query("limit").optional().isInt({ min: 1, max: 50 }),
];

export const applicationIdRules = [param("id").isUUID().withMessage("Invalid application id")];

export const bulkDecisionRules = [
  param("id").isUUID().withMessage("Invalid shift id"),
  body("action").isIn(["shortlist", "reject"]).withMessage("action must be 'shortlist' or 'reject'"),
  body("application_ids").isArray({ min: 1, max: 100 }).withMessage("application_ids must be a non-empty array (max 100)"),
  body("application_ids.*").isUUID().withMessage("each application id must be a valid UUID"),
];
