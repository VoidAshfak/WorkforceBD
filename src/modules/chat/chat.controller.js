import { validationResult } from "express-validator";
import { sendSuccess, sendError } from "../../utils/response.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as chatService from "./chat.service.js";

const reject = (res, errors) => sendError(res, 422, "Validation failed", errors.array());

export const openConversation = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return reject(res, errors);

  const data = await chatService.openConversation(req.user.id, {
    shift_id: req.body.shift_id,
    worker_profile_id: req.body.worker_profile_id,
  }, req.user.active_role ?? null);
  return sendSuccess(res, 200, "Conversation ready", data);
});

export const listConversations = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return reject(res, errors);

  const { page, limit } = req.query;
  const data = await chatService.listConversations(req.user.id, {
    page: page ? Number(page) : undefined,
    limit: limit ? Number(limit) : undefined,
  }, req.user.active_role ?? null);
  return sendSuccess(res, 200, "Conversations fetched", data);
});

export const listMessages = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return reject(res, errors);

  const { page, limit } = req.query;
  const data = await chatService.listMessages(req.user.id, req.params.id, {
    page: page ? Number(page) : undefined,
    limit: limit ? Number(limit) : undefined,
  }, req.user.active_role ?? null);
  return sendSuccess(res, 200, "Messages fetched", data);
});

export const sendMessage = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return reject(res, errors);

  const data = await chatService.sendMessage(req.user.id, req.params.id, req.body.body, req.user.active_role ?? null);
  return sendSuccess(res, 201, "Message sent", data);
});

export const markRead = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return reject(res, errors);

  const data = await chatService.markConversationRead(req.user.id, req.params.id, req.user.active_role ?? null);
  return sendSuccess(res, 200, "Conversation marked read", data);
});

export const getUnreadCount = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return reject(res, errors);

  const data = await chatService.getUnreadCount(req.user.id, req.user.active_role ?? null, req.query.shift_id);
  return sendSuccess(res, 200, "Unread count fetched", data);
});
