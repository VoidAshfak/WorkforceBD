import { body } from "express-validator";

export const presignRules = [
  body("purpose")
    .notEmpty().withMessage("purpose is required")
    .isIn(["profile_picture", "nid_front", "nid_back", "selfie", "student_id", "trade_license", "business_doc", "business_logo"])
    .withMessage("Invalid purpose. Must be one of: profile_picture, nid_front, nid_back, selfie, student_id, trade_license, business_doc, business_logo"),
];
