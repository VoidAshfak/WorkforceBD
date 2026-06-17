import { prisma } from "../../db/index.js";

// Fields exposed to clients (internal delivery columns stay hidden).
const publicSelect = {
  id: true,
  type: true,
  priority: true,
  title: true,
  body: true,
  data: true,
  is_read: true,
  read_at: true,
  created_at: true,
};

/**
 * Persists a notification and returns it in client-safe shape.
 * @param {object} data
 */
export const create = (data) => {
  return prisma.notifications.create({ data, select: publicSelect });
};

/**
 * A user's notifications, newest first, optionally filtered to unread.
 * @param {{ userId: string, isRead?: boolean, skip: number, take: number }} opts
 */
export const findByUser = ({ userId, isRead, skip, take }) => {
  const where = { user_id: userId, deleted_at: null };
  if (isRead !== undefined) where.is_read = isRead;

  return prisma.notifications.findMany({
    where,
    orderBy: { created_at: "desc" },
    skip,
    take,
    select: publicSelect,
  });
};

/** @param {{ userId: string, isRead?: boolean }} opts */
export const countByUser = ({ userId, isRead }) => {
  const where = { user_id: userId, deleted_at: null };
  if (isRead !== undefined) where.is_read = isRead;
  return prisma.notifications.count({ where });
};

/** Unread badge count. @param {string} userId */
export const countUnread = (userId) => {
  return prisma.notifications.count({
    where: { user_id: userId, deleted_at: null, is_read: false },
  });
};

/**
 * A single notification owned by the user (ownership guard).
 * @param {string} id
 * @param {string} userId
 */
export const findOwned = (id, userId) => {
  return prisma.notifications.findFirst({
    where: { id, user_id: userId, deleted_at: null },
    select: publicSelect,
  });
};

/** @param {string} id */
export const markRead = (id) => {
  return prisma.notifications.update({
    where: { id },
    data: { is_read: true, read_at: new Date() },
    select: publicSelect,
  });
};

/**
 * Marks every unread notification for the user as read.
 * @param {string} userId
 * @returns {Promise<{ count: number }>}
 */
export const markAllRead = (userId) => {
  return prisma.notifications.updateMany({
    where: { user_id: userId, deleted_at: null, is_read: false },
    data: { is_read: true, read_at: new Date() },
  });
};
