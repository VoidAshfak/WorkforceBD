import { body } from "express-validator";

export const basicInfoRules = [
  body("full_name").trim().notEmpty().withMessage("Full name is required").isLength({ max: 100 }),
  body("gender")
    .optional()
    .isIn(["male", "female", "other", "prefer_not_to_say"]).withMessage("Invalid gender value"),
  body("date_of_birth")
    .optional()
    .isDate({ format: "YYYY-MM-DD" }).withMessage("Date of birth must be YYYY-MM-DD"),
  body("profile_picture").optional().isURL().withMessage("profile_picture must be a valid URL"),
  body("zone_ids").optional().isArray().withMessage("zone_ids must be an array"),
  body("zone_ids.*").isUUID().withMessage("Each zone_id must be a valid UUID"),
];

export const skillsRules = [
  body("skill_ids")
    .isArray({ min: 1 }).withMessage("Select at least one skill"),
  body("skill_ids.*").isUUID().withMessage("Each skill_id must be a valid UUID"),
];

export const availabilityRules = [
  body("availability_days")
    .isArray({ min: 1 }).withMessage("Select at least one day"),
  body("availability_days.*")
    .isIn(["weekdays", "weekends"]).withMessage("Days must be 'weekdays' or 'weekends'"),
  body("availability_slots")
    .isArray({ min: 1 }).withMessage("Select at least one time slot"),
  body("availability_slots.*")
    .isIn(["morning", "evening", "night"]).withMessage("Slots must be 'morning', 'evening', or 'night'"),
  body("zone_ids").optional().isArray().withMessage("zone_ids must be an array"),
  body("zone_ids.*").isUUID().withMessage("Each zone_id must be a valid UUID"),
];

export const documentsRules = [
  body("nid_front_url").notEmpty().isURL().withMessage("nid_front_url is required and must be a URL"),
  body("nid_back_url").notEmpty().isURL().withMessage("nid_back_url is required and must be a URL"),
  body("selfie_url").notEmpty().isURL().withMessage("selfie_url is required and must be a URL"),
  body("student_id_url").optional().isURL().withMessage("student_id_url must be a valid URL"),
];
