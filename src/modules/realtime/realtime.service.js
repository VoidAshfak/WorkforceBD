import { generateSocketTicket } from "../../utils/token.js";
import { env } from "../../config/env.js";

// Numeric seconds the minted ticket stays valid — derived from the same env
// value used to sign it, so the client's countdown matches the JWT exp.
const expiresInSeconds = parseInt(env.socketTicketExpiresIn, 10) || 60;

/**
 * Mints a short-lived ticket the client swaps for a Socket.IO connection.
 * @param {string} userId
 * @returns {{ ticket: string, expires_in: number }}
 */
export const mintTicket = (userId) => {
  const ticket = generateSocketTicket(userId);
  return { ticket, expires_in: expiresInSeconds };
};
