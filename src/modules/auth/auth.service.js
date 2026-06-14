import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { generateOtp } from "../../utils/otp.js";
import { generateAccessToken, generateRefreshToken } from "../../utils/token.js";
import * as authRepository from "./auth.repository.js";

/**
 * Generates and stores OTP. Logs to console in dev (no SMS yet).
 * @param {string} phone
 * @param {"login"|"register"|"verify_phone"|"reset"} purpose
 */
export const sendOtp = async (phone, purpose) => {
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + env.otpExpiresInMinutes * 60 * 1000);

  await authRepository.createOtpRequest({ phone, otp_code: otp, purpose, expires_at: expiresAt });

  // TODO: integrate SMS gateway
  logger.debug(`OTP for ${phone}: ${otp}`);
};

/**
 * Builds the safe user object included in auth responses.
 * @param {object} user
 */
const formatUser = (user) => ({
  id: user.id,
  phone: user.phone,
  email: user.email,
  full_name: user.full_name,
  roles: user.roles,
  is_phone_verified: user.is_phone_verified,
});

/**
 * Creates session + tokens for an authenticated user.
 * @param {object} user
 * @param {{ ipAddress?: string, userAgent?: string }} meta
 */
const issueTokens = async (user, meta = {}) => {
  const accessToken = generateAccessToken({ id: user.id, roles: user.roles });
  const refreshTokenValue = generateRefreshToken();

  const session = await authRepository.createSession({
    user_id: user.id,
    access_token: accessToken,
    expires_at: new Date(Date.now() + 15 * 60 * 1000),
    ...(meta.ipAddress && { ip_address: meta.ipAddress }),
    ...(meta.userAgent && { user_agent: meta.userAgent }),
  });

  await authRepository.createRefreshToken({
    session_id: session.id,
    user_id: user.id,
    token: refreshTokenValue,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  return { accessToken, refreshToken: refreshTokenValue };
};

/**
 * Verifies OTP then registers or logs in the user based on purpose.
 * - register: assigns role, creates profile stub for workers
 * - login: finds existing user, rejects if not found
 * @param {string} phone
 * @param {string} otpCode
 * @param {"login"|"register"} purpose
 * @param {"worker"|"business"|undefined} role  required when purpose=register
 * @param {{ ipAddress?: string, userAgent?: string }} meta
 */
export const verifyOtpAndAuthenticate = async (phone, otpCode, purpose, role, meta = {}) => {
  const otpRecord = await authRepository.findValidOtp(phone, otpCode, purpose);
  if (!otpRecord) {
    const err = new Error("Invalid or expired OTP");
    err.statusCode = 400;
    throw err;
  }

  await authRepository.markOtpAsUsed(otpRecord.id);

  let user = await authRepository.findUserByPhone(phone);

  if (purpose === "register") {
    if (!user) {
      // New user — create with chosen role
      user = await authRepository.createUser({ phone, roles: [role] });
    } else if (!user.roles.includes(role)) {
      // Existing user adding a new role
      user = await authRepository.updateUser(user.id, { roles: [...user.roles, role] });
    }

    // Auto-create worker profile stub (business profile needs more info — set up separately)
    if (role === "worker") {
      const existingProfile = await authRepository.findWorkerProfile(user.id);
      if (!existingProfile) {
        await authRepository.createWorkerProfile(user.id);
      }
    }
  } else {
    // login
    if (!user) {
      const err = new Error("No account found for this phone number. Please register first.");
      err.statusCode = 404;
      throw err;
    }
  }

  if (!user.is_phone_verified) {
    user = await authRepository.updateUser(user.id, { is_phone_verified: true });
  }

  if (!user.is_active) {
    const err = new Error("Account is deactivated");
    err.statusCode = 403;
    throw err;
  }

  const { accessToken, refreshToken } = await issueTokens(user, meta);

  return { accessToken, refreshToken, user: formatUser(user) };
};

/**
 * Issues new access token from a valid, non-revoked refresh token.
 * @param {string} refreshToken
 */
export const refreshAccessToken = async (refreshToken) => {
  const record = await authRepository.findRefreshToken(refreshToken);

  if (!record || record.is_revoked || record.expires_at < new Date()) {
    const err = new Error("Invalid or expired refresh token");
    err.statusCode = 401;
    throw err;
  }

  if (record.sessions.status !== "active") {
    const err = new Error("Session is no longer active");
    err.statusCode = 401;
    throw err;
  }

  const user = record.users;
  const accessToken = generateAccessToken({ id: user.id, roles: user.roles });

  return { accessToken };
};

/**
 * Revokes session associated with the given refresh token.
 * @param {string} refreshToken
 */
export const logout = async (refreshToken) => {
  const record = await authRepository.findRefreshToken(refreshToken);
  if (!record) return;
  await authRepository.revokeSession(record.session_id);
};
