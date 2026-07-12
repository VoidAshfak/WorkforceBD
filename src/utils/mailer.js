import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

// Lazily created so boot doesn't fail when Gmail creds are absent (dev).
let transporter = null;

const getTransporter = () => {
  if (!env.gmail.user || !env.gmail.appPassword) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: env.gmail.user, pass: env.gmail.appPassword },
    });
  }
  return transporter;
};

/**
 * Sends an email through Gmail SMTP. Without GMAIL_USER/GMAIL_APP_PASSWORD the
 * message is logged instead of sent (dev fallback) so flows stay testable.
 * @param {{ to: string, subject: string, text: string, html?: string }} mail
 * @returns {Promise<boolean>} whether the mail was actually sent
 */
export const sendMail = async ({ to, subject, text, html }) => {
  const transport = getTransporter();
  if (!transport) {
    logger.warn(`Mail not sent (no Gmail creds) | to=${to} subject="${subject}"`);
    logger.debug(`Mail body for ${to}: ${text}`);
    return false;
  }
  await transport.sendMail({ from: `"Workforce BD" <${env.gmail.user}>`, to, subject, text, html });
  logger.info(`Mail sent | to=${to} subject="${subject}"`);
  return true;
};
