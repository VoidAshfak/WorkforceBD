import { validationResult } from "express-validator";
import { sendSuccess, sendError } from "../../utils/response.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as notificationService from "./notification.service.js";

export const listNotifications = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const { unread, page, limit } = req.query;
  const data = await notificationService.listNotifications(req.user.id, {
    unread: unread === true || unread === "true",
    page: page ? Number(page) : undefined,
    limit: limit ? Number(limit) : undefined,
  });
  return sendSuccess(res, 200, "Notifications fetched", data);
});

export const getUnreadCount = asyncHandler(async (req, res) => {
  const data = await notificationService.getUnreadCount(req.user.id);
  return sendSuccess(res, 200, "Unread count fetched", data);
});

export const markRead = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const data = await notificationService.markRead(req.user.id, req.params.id);
  return sendSuccess(res, 200, "Notification marked read", data);
});

export const markAllRead = asyncHandler(async (req, res) => {
  const data = await notificationService.markAllRead(req.user.id);
  return sendSuccess(res, 200, "All notifications marked read", data);
});
