import { body, query, param } from "express-validator";

const PAYOUT_METHODS = ["bkash", "nagad", "bank_transfer"];

const paginationRules = [
  query("page").optional().isInt({ min: 1 }).toInt().withMessage("page must be a positive integer"),
  query("limit").optional().isInt({ min: 1, max: 50 }).toInt().withMessage("limit must be 1–50"),
];

export const listTransactionsRules = [...paginationRules];

export const listPayoutsRules = [
  query("status").optional().isIn(["pending", "sent", "failed"]).withMessage("Invalid status"),
  ...paginationRules,
];

export const requestPayoutRules = [
  body("amount").isFloat({ gt: 0 }).withMessage("amount must be greater than 0"),
  body("method").notEmpty().isIn(PAYOUT_METHODS).withMessage(`method must be one of: ${PAYOUT_METHODS.join(", ")}`),
  body("account_number")
    .trim()
    .notEmpty().withMessage("account_number is required")
    .bail()
    .isLength({ min: 6, max: 20 }).withMessage("account_number must be 6–20 chars"),
  body("account_name").optional().trim().isLength({ max: 100 }).withMessage("account_name must be under 100 chars"),
];

export const shiftIdRules = [param("shiftId").isUUID().withMessage("Invalid shift id")];

export const listPayoutQueueRules = [
  query("status").optional().isIn(["pending", "sent", "failed"]).withMessage("Invalid status"),
  ...paginationRules,
];

export const processPayoutRules = [
  param("payoutId").isUUID().withMessage("Invalid payout id"),
  body("decision").notEmpty().isIn(["approve", "reject"]).withMessage("decision must be 'approve' or 'reject'"),
  // a rejection must explain why
  body("failure_reason")
    .if(body("decision").equals("reject"))
    .trim()
    .notEmpty().withMessage("failure_reason is required when rejecting")
    .bail()
    .isLength({ max: 500 }).withMessage("failure_reason must be under 500 chars"),
];
