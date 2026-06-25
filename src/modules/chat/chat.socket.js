import { logger } from "../../config/logger.js";
import { CHAT_MESSAGE_MAX_LENGTH } from "../../constants.js";
import * as chatService from "./chat.service.js";

// Loose UUID shape check — full ownership/participant checks live in the service.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Invokes the Socket.IO ack callback if the client supplied one. */
const ack = (cb, payload) => {
  if (typeof cb === "function") cb(payload);
};

/** Maps a thrown error to a client-safe ack message (hide non-operational bugs). */
const errorAck = (cb, err, fallback) => {
  ack(cb, { ok: false, error: err?.isOperational ? err.message : fallback });
};

/**
 * Registers chat event handlers on a connected, authenticated socket. The send
 * path mirrors `POST /chat/conversations/:id/messages` so REST and socket share
 * the exact same service logic, validation intent, and real-time broadcast.
 * @param {import("socket.io").Socket} socket - carries `socket.user` from the handshake
 */
export const registerChatSocket = (socket) => {
  const userId = socket.user.id;

  // chat:send → persist + broadcast. Ack returns { ok, message } | { ok:false, error }.
  socket.on("chat:send", async (payload, cb) => {
    try {
      const conversationId = payload?.conversation_id;
      const body = typeof payload?.body === "string" ? payload.body.trim() : "";

      if (!UUID_RE.test(conversationId ?? "")) return ack(cb, { ok: false, error: "Invalid conversation id" });
      if (!body) return ack(cb, { ok: false, error: "Message body is required" });
      if (body.length > CHAT_MESSAGE_MAX_LENGTH) {
        return ack(cb, { ok: false, error: `Message body must be at most ${CHAT_MESSAGE_MAX_LENGTH} characters` });
      }

      const message = await chatService.sendMessage(userId, conversationId, body);
      ack(cb, { ok: true, message });
    } catch (err) {
      logger.warn(`chat:send failed | userId=${userId} ${err.message}`);
      errorAck(cb, err, "Failed to send message");
    }
  });

  // chat:read → mark incoming read + emit chat:read receipt to the counterpart.
  socket.on("chat:read", async (payload, cb) => {
    try {
      const conversationId = payload?.conversation_id;
      if (!UUID_RE.test(conversationId ?? "")) return ack(cb, { ok: false, error: "Invalid conversation id" });

      const result = await chatService.markConversationRead(userId, conversationId);
      ack(cb, { ok: true, ...result });
    } catch (err) {
      logger.warn(`chat:read failed | userId=${userId} ${err.message}`);
      errorAck(cb, err, "Failed to mark read");
    }
  });
};
