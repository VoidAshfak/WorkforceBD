import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../utils/AppError.js";
import { generateOtp, hashOtp } from "../../utils/otp.js";
import { generateAccessToken, generateRefreshToken, hashRefreshToken } from "../../utils/token.js";
import * as authRepository from "./auth.repository.js";

// Single passwordless flow — purpose is no longer branched on (register/login unified).
const OTP_PURPOSE = "login";

/**
 * Generates and stores a hashed OTP. Logs the plain OTP to console in dev (no SMS yet).
 * @param {string} phone
 */
export const sendOtp = async (phone) => {
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + env.otpExpiresInMinutes * 60 * 1000);
  await authRepository.createOtpRequest({
    phone,
    otp_code: hashOtp(otp),
    purpose: OTP_PURPOSE,
    expires_at: expiresAt,
  });
  logger.info(`OTP requested | phone=${phone}`);
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

// Worker onboarding steps in order — drives `profile_completion` and `next_step`.
const WORKER_STEPS = [
  { key: "basic", done: (p) => Boolean(p.full_name && p.date_of_birth) },
  { key: "skills", done: (p) => (p._count?.worker_skills ?? 0) > 0 },
  { key: "availability", done: (p) => p.availability_days?.length > 0 && p.availability_slots?.length > 0 },
  { key: "documents", done: (p) => Boolean(p.nid_front_url && p.nid_back_url && p.selfie_url) },
];

/**
 * Builds the worker profile summary the frontend uses to gate access
 * (full vs restrictive view) and resume onboarding.
 * @param {string} userId
 */
const buildWorkerSummary = async (userId) => {
  const profile = await authRepository.findWorkerProfileSummary(userId);
  if (!profile) return { exists: false, verification_status: null, profile_completion: 0, next_step: "basic" };

  const doneCount = WORKER_STEPS.filter((s) => s.done(profile)).length;
  const nextStep = WORKER_STEPS.find((s) => !s.done(profile))?.key ?? null;
  return {
    exists: true,
    verification_status: profile.verification_status,
    profile_completion: Math.round((doneCount / WORKER_STEPS.length) * 100),
    next_step: profile.verification_status === "verified" ? null : nextStep,
  };
};

/**
 * Business profile summary. Stub-less (business onboarding not built yet),
 * so a missing profile means the user must still create it.
 * @param {string} userId
 */
const buildBusinessSummary = async (userId) => {
  const profile = await authRepository.findBusinessProfileSummary(userId);
  if (!profile) return { exists: false, verification_status: null, next_step: "create_business" };
  return { exists: true, verification_status: profile.verification_status, next_step: null };
};

/**
 * Returns the access summary for a single active role (null for admin/no role).
 * @param {"worker"|"business"|undefined} role
 * @param {string} userId
 */
const buildActiveProfile = (role, userId) => {
  if (role === "worker") return buildWorkerSummary(userId);
  if (role === "business") return buildBusinessSummary(userId);
  return Promise.resolve(null);
};

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
    token: hashRefreshToken(refreshTokenValue), // store hash, never the raw token
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  return { accessToken, refreshToken: refreshTokenValue };
};

/**
 * Single passwordless entry: verifies OTP, then creates-or-logs-in the user.
 * Role is chosen first (role selection screen):
 * - new phone  → account created with [role] (role required), worker gets a profile stub
 * - known phone, new role → role added, worker gets a profile stub
 * - known phone, same role (or no role, e.g. admin) → login
 * Returns tokens + the active role's profile summary so the frontend can pick
 * full vs restrictive access.
 * @param {string} phone
 * @param {string} otpCode
 * @param {"worker"|"business"|undefined} role
 * @param {{ ipAddress?: string, userAgent?: string }} meta
 */
export const verifyOtpAndAuthenticate = async (phone, otpCode, role, meta = {}) => {
  const otpRecord = await authRepository.findValidOtp(phone, hashOtp(otpCode), OTP_PURPOSE);
  if (!otpRecord) {
    logger.warn(`OTP invalid or expired | phone=${phone}`);
    throw new AppError("Invalid or expired OTP", 400);
  }

  await authRepository.markOtpAsUsed(otpRecord.id);
  logger.info(`OTP verified | phone=${phone}`);

  let user = await authRepository.findUserByPhone(phone);

  if (!user) {
    // First time on this phone — must know which role to create the account as.
    if (!role) throw new AppError("Role is required to create an account", 400);
    user = await authRepository.createUser({ phone, roles: [role] });
    logger.info(`User registered | id=${user.id} phone=${phone} role=${role}`);
  } else if (role && !user.roles.includes(role)) {
    // Existing account adopting a second role (e.g. worker who now wants to hire).
    user = await authRepository.updateUser(user.id, { roles: [...user.roles, role] });
    logger.info(`Role added | userId=${user.id} role=${role} allRoles=${user.roles}`);
  } else {
    logger.info(`User login | id=${user.id} phone=${phone}`);
  }

  // Workers get a profile stub immediately so onboarding steps have a row to write to.
  if (role === "worker") {
    const existingProfile = await authRepository.findWorkerProfile(user.id);
    if (!existingProfile) {
      await authRepository.createWorkerProfile(user.id);
      logger.info(`Worker profile stub created | userId=${user.id}`);
    }
  }

  if (!user.is_phone_verified) {
    user = await authRepository.updateUser(user.id, { is_phone_verified: true });
  }

  if (!user.is_active) {
    logger.warn(`Login blocked — account deactivated | userId=${user.id}`);
    throw new AppError("Account is deactivated", 403);
  }

  const { accessToken, refreshToken } = await issueTokens(user, meta);
  const activeProfile = await buildActiveProfile(role, user.id);
  logger.info(`Session issued | userId=${user.id} role=${role ?? "none"}`);
  return {
    accessToken,
    refreshToken,
    user: formatUser(user),
    active_role: role ?? null,
    profile: activeProfile,
  };
};

/**
 * Issues new access token from a valid, non-revoked refresh token.
 * @param {string} refreshToken
 */
export const refreshAccessToken = async (refreshToken) => {
  const tokenHash = hashRefreshToken(refreshToken);
  const record = await authRepository.findRefreshToken(tokenHash);

  if (!record) {
    logger.warn("Refresh token not recognized");
    throw new AppError("Invalid or expired refresh token", 401);
  }

  // Reuse detection: a revoked token being replayed signals theft of a rotated
  // token. Kill the whole session family so neither party can continue.
  if (record.is_revoked) {
    logger.warn(`Revoked refresh token replayed — revoking session | sessionId=${record.session_id}`);
    await authRepository.revokeSession(record.session_id);
    throw new AppError("Session has been terminated for security reasons", 401);
  }

  if (record.expires_at < new Date()) {
    logger.warn("Refresh token expired");
    throw new AppError("Invalid or expired refresh token", 401);
  }
  if (record.sessions.status !== "active") {
    logger.warn(`Refresh token used on inactive session | sessionId=${record.session_id}`);
    throw new AppError("Session is no longer active", 401);
  }

  const user = record.users;

  // Rotate: revoke old token, issue new one (store hash only)
  await authRepository.revokeRefreshToken(tokenHash);
  const newRefreshToken = generateRefreshToken();
  await authRepository.createRefreshToken({
    session_id: record.session_id,
    user_id: user.id,
    token: hashRefreshToken(newRefreshToken),
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  const accessToken = generateAccessToken({ id: user.id, roles: user.roles });
  logger.info(`Tokens rotated | userId=${user.id}`);
  return { accessToken, refreshToken: newRefreshToken };
};

/**
 * Revokes session associated with the given refresh token.
 * @param {string} refreshToken
 */
/**
 * Returns the authenticated user's profile. Used for session validation on app open.
 * @param {string} userId
 */
export const getMe = async (userId) => {
  const user = await authRepository.findUserById(userId);
  if (!user) throw new AppError("User not found", 404);

  // Per-role profile summaries let the frontend route to full vs restrictive view on app open.
  const profiles = {
    worker: user.roles.includes("worker") ? await buildWorkerSummary(userId) : null,
    business: user.roles.includes("business") ? await buildBusinessSummary(userId) : null,
  };

  return { ...formatUser(user), profiles };
};

export const logout = async (refreshToken) => {
  const record = await authRepository.findRefreshToken(hashRefreshToken(refreshToken));
  if (!record) {
    logger.warn("Logout attempted with unknown refresh token");
    return;
  }
  await authRepository.revokeSession(record.session_id);
  logger.info(`Session revoked | sessionId=${record.session_id} userId=${record.user_id}`);
};
