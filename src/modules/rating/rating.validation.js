import { body, query } from "express-validator";

const score = (field) =>
  body(field).optional().isInt({ min: 1, max: 5 }).withMessage(`${field} must be 1–5`);

export const rateRules = [
  body("assignment_id").notEmpty().isUUID().withMessage("assignment_id is required and must be a UUID"),
  body("overall_score").isInt({ min: 1, max: 5 }).withMessage("overall_score must be 1–5"),
  score("punctuality_score"),
  score("behavior_score"),
  score("skill_score"),
  body("review").optional().trim().isLength({ max: 1000 }).withMessage("review must be under 1000 chars"),
  body("is_anonymous").optional().isBoolean().withMessage("is_anonymous must be a boolean"),
];

export const listRatingsRules = [
  query("direction").optional().isIn(["received", "given"]).withMessage("direction must be 'received' or 'given'"),
  query("page").optional().isInt({ min: 1 }).toInt(),
  query("limit").optional().isInt({ min: 1, max: 50 }).toInt(),
];
