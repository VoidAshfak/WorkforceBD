import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";
import { emitToUser } from "../../socket/io.js";
import * as notificationRepository from "./notification.repository.js";

/**
 * Central notification entry point: persists the row, then pushes it to the
 * owner in real time over Socket.IO (event `notification:new`, carrying the
 * notification plus the fresh unread count). All modules that notify a user
 * must go through here so delivery stays consistent.
 * @param {{ user_id: string, type: string, priority?: string, title: string, body: string, data?: object }} payload
 * @returns {Promise<object>} the created notification
 */
export const createNotification = async (payload) => {
  const notification = await notificationRepository.create(payload);
  const unread = await notificationRepository.countUnread(payload.user_id);
  emitToUser(payload.user_id, "notification:new", { notification, unread_count: unread });
  logger.info(`Notification sent | userId=${payload.user_id} kind=${payload.data?.kind ?? "n/a"}`);
  return notification;
};

/**
 * Paginated notification feed for a user, optionally filtered to unread.
 * @param {string} userId
 * @param {{ unread?: boolean, page?: number, limit?: number }} query
 */
export const listNotifications = async (userId, query) => {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;
  const isRead = query.unread === true ? false : undefined;

  const [items, total, unread] = await Promise.all([
    notificationRepository.findByUser({ userId, isRead, skip, take: limit }),
    notificationRepository.countByUser({ userId, isRead }),
    notificationRepository.countUnread(userId),
  ]);

  return {
    items,
    unread_count: unread,
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
};

/**
 * Unread badge count.
 * @param {string} userId
 */
export const getUnreadCount = async (userId) => {
  const unread = await notificationRepository.countUnread(userId);
  return { unread_count: unread };
};

/**
 * Marks a single owned notification as read (idempotent).
 * @param {string} userId
 * @param {string} notificationId
 */
export const markRead = async (userId, notificationId) => {
  const notification = await notificationRepository.findOwned(notificationId, userId);
  if (!notification) throw new AppError("Notification not found", 404);
  if (notification.is_read) return notification;

  const updated = await notificationRepository.markRead(notificationId);
  logger.info(`Notification read | userId=${userId} id=${notificationId}`);
  return updated;
};

/**
 * Marks all of a user's unread notifications as read.
 * @param {string} userId
 */
export const markAllRead = async (userId) => {
  const { count } = await notificationRepository.markAllRead(userId);
  logger.info(`Notifications marked all read | userId=${userId} count=${count}`);
  return { updated: count };
};
