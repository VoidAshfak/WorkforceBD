import { body, param, query } from "express-validator";
import { DISPUTE_DECISIONS } from "../../constants.js";

const DISPUTE_STATUSES = ["open", "under_review", "resolved", "dismissed"];

export const raiseDisputeRules = [
  body("assignment_id").notEmpty().isUUID().withMessage("assignment_id is required and must be a UUID"),
  body("description")
    .trim().notEmpty().withMessage("Describe what went wrong")
    .isLength({ min: 10, max: 2000 }).withMessage("description must be 10–2000 chars"),
];

export const listDisputesRules = [
  query("status").optional().isIn(DISPUTE_STATUSES).withMessage("Invalid status filter"),
  query("page").optional().isInt({ min: 1 }).toInt(),
  query("limit").optional().isInt({ min: 1, max: 50 }).toInt(),
];

export const resolveDisputeRules = [
  param("id").isUUID().withMessage("Invalid dispute id"),
  body("decision").isIn(DISPUTE_DECISIONS).withMessage(`decision must be one of: ${DISPUTE_DECISIONS.join(", ")}`),
  body("amount")
    .if(body("decision").equals("pay_partial"))
    .notEmpty().withMessage("amount is required for a partial ruling").bail()
    .isFloat({ gt: 0 }).withMessage("amount must be greater than 0"),
  body("resolution_note")
    .trim().notEmpty().withMessage("resolution_note is required — both parties see it")
    .isLength({ max: 2000 }),
];
