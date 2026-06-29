import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";
import { emitToUser } from "../../socket/io.js";
import { CHAT_PREVIEW_LENGTH } from "../../constants.js";
import * as chatRepository from "./chat.repository.js";

/**
 * Resolves which side of a conversation the user is acting as, or null if they
 * are not a participant. A user holding both profiles is matched by whichever
 * profile id the conversation references.
 * @param {object} conv
 * @param {{ workerProfileId: string|null, businessProfileId: string|null }} profiles
 * @returns {"worker"|"business"|null}
 */
const resolveSide = (conv, profiles) => {
  if (profiles.workerProfileId && conv.worker_profile_id === profiles.workerProfileId) return "worker";
  if (profiles.businessProfileId && conv.business_profile_id === profiles.businessProfileId) return "business";
  return null;
};

/**
 * Restricts a user's profile pair to the side matching their active account
 * context, so a dual-role user's worker and business inboxes stay separate.
 * Tokens minted before `active_role` existed keep the legacy merged (both-sides)
 * view until they refresh.
 * @param {{ workerProfileId: string|null, businessProfileId: string|null }} profiles
 * @param {string|null|undefined} activeRole
 */
const scopeToActiveRole = (profiles, activeRole) => {
  if (activeRole === "worker") return { workerProfileId: profiles.workerProfileId, businessProfileId: null };
  if (activeRole === "business") return { workerProfileId: null, businessProfileId: profiles.businessProfileId };
  return profiles;
};

/**
 * Loads the user's profiles already scoped to their active role.
 * @param {string} userId
 * @param {string|null|undefined} activeRole
 */
const scopedProfiles = async (userId, activeRole) =>
  scopeToActiveRole(await chatRepository.findUserProfiles(userId), activeRole);

/** User id of the participant on the opposite side. */
const counterpartUserId = (conv, side) =>
  side === "worker" ? conv.business_profiles.user_id : conv.worker_profiles.user_id;

/**
 * Pushes a new message to BOTH participants' rooms. The counterpart sees it
 * arrive; the sender's other tabs/devices stay in sync. The originating client
 * (REST response or socket ack) should dedupe by `message.id`.
 * @param {object} conv
 * @param {object} message
 */
const broadcastMessage = (conv, message) => {
  const payload = { conversation_id: conv.id, message };
  emitToUser(conv.worker_profiles.user_id, "chat:message", payload);
  emitToUser(conv.business_profiles.user_id, "chat:message", payload);
};

const preview = (text) =>
  text.length > CHAT_PREVIEW_LENGTH ? `${text.slice(0, CHAT_PREVIEW_LENGTH - 1)}…` : text;

/**
 * Conversation DTO from the viewer's perspective — folds the counterpart into a
 * single shape regardless of which side the viewer is on.
 * @param {object} conv
 * @param {"worker"|"business"} side
 * @param {number} unread
 */
const toConversationDto = (conv, side, unread) => ({
  id: conv.id,
  side,
  shift: conv.shifts,
  counterpart: side === "worker"
    ? {
      type: "business",
      id: conv.business_profiles.id,
      name: conv.business_profiles.business_name,
      avatar: conv.business_profiles.logo_url,
    }
    : {
      type: "worker",
      id: conv.worker_profiles.id,
      name: conv.worker_profiles.full_name,
      avatar: conv.worker_profiles.profile_picture,
    },
  last_message: conv.last_message_text
    ? { text: conv.last_message_text, at: conv.last_message_at, sender_role: conv.last_sender_role }
    : null,
  unread_count: unread,
  created_at: conv.created_at,
});

/**
 * Opens (or returns the existing) per-shift conversation for a worker/business
 * pair. Gated: an application must already exist for that pair. The worker side
 * is the caller when they hold a worker profile; otherwise the caller must own
 * the shift's business and name the worker via `worker_profile_id`.
 * @param {string} userId
 * @param {{ shift_id: string, worker_profile_id?: string }} data
 * @param {string|null} [activeRole] - acting account context (worker/business)
 */
export const openConversation = async (userId, { shift_id, worker_profile_id }, activeRole = null) => {
  const profiles = scopeToActiveRole(await chatRepository.findUserProfiles(userId), activeRole);

  const shift = await chatRepository.findShift(shift_id);
  if (!shift) throw new AppError("Shift not found", 404);

  const ownsShift = profiles.businessProfileId && profiles.businessProfileId === shift.business_profile_id;

  let workerProfileId;
  let businessProfileId;
  let side;
  if (ownsShift) {
    businessProfileId = profiles.businessProfileId;
    workerProfileId = worker_profile_id;
    side = "business";
    if (!workerProfileId) throw new AppError("worker_profile_id is required to message a worker", 422);
  } else if (profiles.workerProfileId) {
    workerProfileId = profiles.workerProfileId;
    businessProfileId = shift.business_profile_id;
    side = "worker";
  } else {
    throw new AppError("You are not a participant of this shift", 403);
  }

  const gated = await chatRepository.applicationExists(shift.id, workerProfileId);
  if (!gated) {
    throw new AppError("A conversation is only available after the worker applies to this shift", 403);
  }

  const existing = await chatRepository.findConversationByPair(shift.id, workerProfileId);
  if (existing) {
    const unread = await chatRepository.countUnreadInConversation(existing.id, side);
    return toConversationDto(existing, side, unread);
  }

  let conv;
  try {
    conv = await chatRepository.createConversation({
      shift_id: shift.id,
      worker_profile_id: workerProfileId,
      business_profile_id: businessProfileId,
      created_by: userId,
    });
  } catch (err) {
    // Lost the create race against a concurrent open — fetch the winner.
    if (err.code === "P2002") {
      conv = await chatRepository.findConversationByPair(shift.id, workerProfileId);
    } else {
      throw err;
    }
  }

  logger.info(`Conversation opened | userId=${userId} shift=${shift.id} convo=${conv.id}`);
  return toConversationDto(conv, side, 0);
};

/**
 * Paginated inbox of the user's conversations, latest activity first.
 * @param {string} userId
 * @param {{ page?: number, limit?: number }} query
 * @param {string|null} [activeRole] - acting account context (worker/business)
 */
export const listConversations = async (userId, query, activeRole = null) => {
  const profiles = await scopedProfiles(userId, activeRole);
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    chatRepository.findConversationsForUser({ ...profiles, skip, take: limit }),
    chatRepository.countConversationsForUser(profiles),
  ]);

  // Per-conversation unread depends on the viewer's side, so resolve each row.
  const items = await Promise.all(rows.map(async (conv) => {
    const side = resolveSide(conv, profiles);
    const unread = await chatRepository.countUnreadInConversation(conv.id, side);
    return toConversationDto(conv, side, unread);
  }));

  return { items, pagination: { page, limit, total, total_pages: Math.ceil(total / limit) } };
};

/**
 * Loads an owned conversation and the viewer's side, or throws 404/403.
 * @param {string} userId
 * @param {string} conversationId
 * @param {string|null} [activeRole] - acting account context (worker/business)
 */
const getOwnedConversation = async (userId, conversationId, activeRole = null) => {
  const conv = await chatRepository.findConversationById(conversationId);
  if (!conv) throw new AppError("Conversation not found", 404);

  // Scoped to the active role: a worker-context request can't reach a
  // business-side conversation (and vice versa), keeping the two inboxes apart.
  const profiles = scopeToActiveRole(await chatRepository.findUserProfiles(userId), activeRole);
  const side = resolveSide(conv, profiles);
  if (!side) throw new AppError("Conversation not found", 404);
  return { conv, side };
};

/**
 * Message history for a conversation (newest first). Opening the thread marks
 * incoming messages as read and notifies the sender's read receipt.
 * @param {string} userId
 * @param {string} conversationId
 * @param {{ page?: number, limit?: number }} query
 * @param {string|null} [activeRole] - acting account context (worker/business)
 */
export const listMessages = async (userId, conversationId, query, activeRole = null) => {
  const { conv, side } = await getOwnedConversation(userId, conversationId, activeRole);

  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 30));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    chatRepository.findMessages({ conversationId, skip, take: limit }),
    chatRepository.countMessages(conversationId),
  ]);

  // Reading the first page clears the unread badge for incoming messages.
  await markRead(conv, side);

  return {
    conversation: toConversationDto(conv, side, 0),
    items,
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
};

/**
 * Sends a message in a conversation and pushes it to the counterpart in real
 * time (`chat:message`).
 * @param {string} userId
 * @param {string} conversationId
 * @param {string} body
 * @param {string|null} [activeRole] - acting account context (worker/business)
 */
export const sendMessage = async (userId, conversationId, body, activeRole = null) => {
  const { conv, side } = await getOwnedConversation(userId, conversationId, activeRole);

  const message = await chatRepository.createMessage({
    conversation_id: conv.id,
    sender_user_id: userId,
    sender_role: side,
    body,
  });

  await chatRepository.touchConversation(conv.id, {
    last_message_at: message.created_at,
    last_message_text: preview(body),
    last_sender_role: side,
    updated_by: userId,
  });

  broadcastMessage(conv, message);
  logger.info(`Chat message sent | userId=${userId} convo=${conv.id} role=${side}`);
  return message;
};

/**
 * Marks all incoming messages in a conversation as read and emits a read receipt
 * (`chat:read`) to the counterpart. Idempotent.
 * @param {object} conv - loaded conversation (with profile relations)
 * @param {"worker"|"business"} side - viewer's side
 * @returns {Promise<number>} messages flipped to read
 */
const markRead = async (conv, side) => {
  const at = new Date();
  const count = await chatRepository.markIncomingRead(conv.id, side, at);
  if (count > 0) {
    emitToUser(counterpartUserId(conv, side), "chat:read", {
      conversation_id: conv.id,
      reader_role: side,
      read_at: at,
      count,
    });
  }
  return count;
};

/**
 * Public mark-as-read endpoint handler.
 * @param {string} userId
 * @param {string} conversationId
 * @param {string|null} [activeRole] - acting account context (worker/business)
 */
export const markConversationRead = async (userId, conversationId, activeRole = null) => {
  const { conv, side } = await getOwnedConversation(userId, conversationId, activeRole);
  const updated = await markRead(conv, side);
  return { updated };
};

/**
 * Total unread message count across the user's conversations (badge), scoped to
 * the active account context. Pass `shiftId` to scope to one shift's threads.
 * @param {string} userId
 * @param {string|null} [activeRole] - acting account context (worker/business)
 * @param {string} [shiftId] - optional shift to scope the count to
 */
export const getUnreadCount = async (userId, activeRole = null, shiftId) => {
  const profiles = await scopedProfiles(userId, activeRole);
  const unread = await chatRepository.countTotalUnread({ ...profiles, shiftId });
  return { unread_count: unread };
};
