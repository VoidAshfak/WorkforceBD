import { prisma } from "../../db/index.js";

// Counterpart identity + shift header attached to every conversation read.
const conversationInclude = {
  shifts: { select: { id: true, title: true, shift_date: true } },
  worker_profiles: { select: { id: true, user_id: true, full_name: true, profile_picture: true } },
  business_profiles: { select: { id: true, user_id: true, business_name: true, logo_url: true } },
};

// Client-safe message shape.
const messageSelect = {
  id: true,
  conversation_id: true,
  sender_user_id: true,
  sender_role: true,
  body: true,
  read_at: true,
  created_at: true,
};

/**
 * Worker + business profile ids owned by a user (either may be null). A user may
 * hold both roles, so chat resolves the acting side per conversation.
 * @param {string} userId
 * @returns {Promise<{ workerProfileId: string|null, businessProfileId: string|null }>}
 */
export const findUserProfiles = async (userId) => {
  const [worker, business] = await Promise.all([
    prisma.worker_profiles.findUnique({ where: { user_id: userId }, select: { id: true } }),
    prisma.business_profiles.findUnique({ where: { user_id: userId }, select: { id: true } }),
  ]);
  return { workerProfileId: worker?.id ?? null, businessProfileId: business?.id ?? null };
};

/**
 * Shift essentials used to scaffold a conversation (owning business + header).
 * @param {string} shiftId
 */
export const findShift = (shiftId) => {
  return prisma.shifts.findFirst({
    where: { id: shiftId, deleted_at: null },
    select: { id: true, title: true, shift_date: true, business_profile_id: true },
  });
};

/**
 * Whether an application exists for the (shift, worker) pair in any state — the
 * gate that authorizes opening a conversation.
 * @param {string} shiftId
 * @param {string} workerProfileId
 * @returns {Promise<boolean>}
 */
export const applicationExists = async (shiftId, workerProfileId) => {
  const app = await prisma.applications.findUnique({
    where: { shift_id_worker_profile_id: { shift_id: shiftId, worker_profile_id: workerProfileId } },
    select: { id: true },
  });
  return !!app;
};

/** @param {string} shiftId @param {string} workerProfileId */
export const findConversationByPair = (shiftId, workerProfileId) => {
  return prisma.chat_conversations.findUnique({
    where: { shift_id_worker_profile_id: { shift_id: shiftId, worker_profile_id: workerProfileId } },
    include: conversationInclude,
  });
};

/** @param {object} data */
export const createConversation = (data) => {
  return prisma.chat_conversations.create({ data, include: conversationInclude });
};

/** @param {string} id */
export const findConversationById = (id) => {
  return prisma.chat_conversations.findFirst({
    where: { id, deleted_at: null },
    include: conversationInclude,
  });
};

/**
 * Conversations the user participates in on either side, latest activity first.
 * @param {{ workerProfileId: string|null, businessProfileId: string|null, skip: number, take: number }} opts
 */
export const findConversationsForUser = ({ workerProfileId, businessProfileId, skip, take }) => {
  return prisma.chat_conversations.findMany({
    where: { deleted_at: null, OR: participantOr(workerProfileId, businessProfileId) },
    orderBy: [{ last_message_at: { sort: "desc", nulls: "last" } }, { created_at: "desc" }],
    skip,
    take,
    include: conversationInclude,
  });
};

/** @param {{ workerProfileId: string|null, businessProfileId: string|null }} opts */
export const countConversationsForUser = ({ workerProfileId, businessProfileId }) => {
  return prisma.chat_conversations.count({
    where: { deleted_at: null, OR: participantOr(workerProfileId, businessProfileId) },
  });
};

/** @param {object} data */
export const createMessage = (data) => {
  return prisma.chat_messages.create({ data, select: messageSelect });
};

/** Messages in a conversation, newest first. @param {{ conversationId: string, skip: number, take: number }} opts */
export const findMessages = ({ conversationId, skip, take }) => {
  return prisma.chat_messages.findMany({
    where: { conversation_id: conversationId, deleted_at: null },
    orderBy: { created_at: "desc" },
    skip,
    take,
    select: messageSelect,
  });
};

/** @param {string} conversationId */
export const countMessages = (conversationId) => {
  return prisma.chat_messages.count({
    where: { conversation_id: conversationId, deleted_at: null },
  });
};

/**
 * Updates the conversation's preview/sort fields after a new message.
 * @param {string} id
 * @param {{ last_message_at: Date, last_message_text: string, last_sender_role: string, updated_by: string }} data
 */
export const touchConversation = (id, data) => {
  return prisma.chat_conversations.update({ where: { id }, data });
};

/**
 * Marks every message NOT sent by the viewer's role as read. Returns the count
 * actually flipped (0 = nothing was unread).
 * @param {string} conversationId
 * @param {string} viewerRole - the reader's role; incoming = the other role
 * @param {Date} at
 * @returns {Promise<number>}
 */
export const markIncomingRead = async (conversationId, viewerRole, at) => {
  const { count } = await prisma.chat_messages.updateMany({
    where: {
      conversation_id: conversationId,
      sender_role: { not: viewerRole },
      read_at: null,
      deleted_at: null,
    },
    data: { read_at: at },
  });
  return count;
};

/**
 * Unread count in one conversation from the viewer's perspective.
 * @param {string} conversationId
 * @param {string} viewerRole
 */
export const countUnreadInConversation = (conversationId, viewerRole) => {
  return prisma.chat_messages.count({
    where: {
      conversation_id: conversationId,
      sender_role: { not: viewerRole },
      read_at: null,
      deleted_at: null,
    },
  });
};

/**
 * Total unread across the user's conversations (badge count). Pass `shiftId` to
 * scope the count to a single shift's conversations.
 * @param {{ workerProfileId: string|null, businessProfileId: string|null, shiftId?: string }} opts
 */
export const countTotalUnread = ({ workerProfileId, businessProfileId, shiftId }) => {
  const convFilter = (extra) => ({ deleted_at: null, ...(shiftId ? { shift_id: shiftId } : {}), ...extra });
  const or = [];
  if (workerProfileId) {
    or.push({ sender_role: "business", chat_conversations: convFilter({ worker_profile_id: workerProfileId }) });
  }
  if (businessProfileId) {
    or.push({ sender_role: "worker", chat_conversations: convFilter({ business_profile_id: businessProfileId }) });
  }
  if (!or.length) return Promise.resolve(0);
  return prisma.chat_messages.count({ where: { read_at: null, deleted_at: null, OR: or } });
};

/**
 * Builds the "I am a participant" OR clause. Falls back to an impossible match
 * when the user owns neither profile, so the query returns nothing.
 * @param {string|null} workerProfileId
 * @param {string|null} businessProfileId
 */
const participantOr = (workerProfileId, businessProfileId) => {
  const or = [];
  if (workerProfileId) or.push({ worker_profile_id: workerProfileId });
  if (businessProfileId) or.push({ business_profile_id: businessProfileId });
  return or.length ? or : [{ id: "__none__" }];
};
