import { body, param, query } from "express-validator";
import { CHAT_MESSAGE_MAX_LENGTH } from "../../constants.js";

export const openConversationRules = [
  body("shift_id").isUUID().withMessage("shift_id must be a valid UUID"),
  body("worker_profile_id").optional().isUUID().withMessage("worker_profile_id must be a valid UUID"),
];

export const unreadCountRules = [
  query("shift_id").optional().isUUID().withMessage("shift_id must be a valid UUID"),
];

export const listConversationsRules = [
  query("page").optional().isInt({ min: 1 }).withMessage("page must be a positive integer"),
  query("limit").optional().isInt({ min: 1, max: 50 }).withMessage("limit must be 1–50"),
];

export const conversationIdRules = [
  param("id").isUUID().withMessage("Invalid conversation id"),
];

export const listMessagesRules = [
  param("id").isUUID().withMessage("Invalid conversation id"),
  query("page").optional().isInt({ min: 1 }).withMessage("page must be a positive integer"),
  query("limit").optional().isInt({ min: 1, max: 50 }).withMessage("limit must be 1–50"),
];

export const sendMessageRules = [
  param("id").isUUID().withMessage("Invalid conversation id"),
  body("body")
    .trim()
    .notEmpty().withMessage("Message body is required")
    .bail()
    .isLength({ max: CHAT_MESSAGE_MAX_LENGTH })
    .withMessage(`Message body must be at most ${CHAT_MESSAGE_MAX_LENGTH} characters`),
];
