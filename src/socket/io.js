import { Server } from "socket.io";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { verifySocketTicket } from "../utils/token.js";

// Single io instance, set on initSocket. Kept module-private; access via helpers.
let io;

// Per-user room name — every emit targets the owner's room so a user receives
// events on all of their connected devices/tabs.
const userRoom = (userId) => `user:${userId}`;

/**
 * Attaches a Socket.IO server to the given HTTP server. Authenticates each
 * connection with a short-lived socket ticket (minted via POST
 * /realtime/ticket, sent in the handshake `auth.token`) and joins the socket to
 * its per-user room. The REST access token is never sent to the browser.
 * @param {import("http").Server} httpServer
 * @returns {import("socket.io").Server}
 */
export const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: { origin: env.frontendUrl, credentials: true },
  });

  // Handshake auth — reject sockets without a valid ticket before they connect.
  io.use((socket, next) => {
    const ticket = socket.handshake.auth?.token;
    if (!ticket) return next(new Error("Authentication ticket required"));
    try {
      socket.user = verifySocketTicket(ticket);
      next();
    } catch {
      next(new Error("Invalid or expired ticket"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(userRoom(socket.user.id));
    logger.info(`Socket connected | userId=${socket.user.id} sid=${socket.id}`);

    socket.on("disconnect", (reason) => {
      logger.debug(`Socket disconnected | sid=${socket.id} reason=${reason}`);
    });
  });

  logger.info("Socket.IO initialized");
  return io;
};

/** @returns {import("socket.io").Server | undefined} */
export const getIo = () => io;

/**
 * Emits an event to a single user's room. No-op when the socket layer is not
 * initialized (e.g. import-time boot checks or tests).
 * @param {string} userId
 * @param {string} event
 * @param {*} payload
 */
export const emitToUser = (userId, event, payload) => {
  if (!io) return;
  io.to(userRoom(userId)).emit(event, payload);
};
