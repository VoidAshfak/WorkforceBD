import { param, query } from "express-validator";

export const listNotificationsRules = [
  query("unread").optional().isBoolean().withMessage("unread must be a boolean").toBoolean(),
  query("page").optional().isInt({ min: 1 }).withMessage("page must be a positive integer"),
  query("limit").optional().isInt({ min: 1, max: 50 }).withMessage("limit must be 1–50"),
];

export const notificationIdRules = [
  param("id").isUUID().withMessage("Invalid notification id"),
];
