import { prisma } from "../../db/index.js";

/** @param {string} phone */
export const findUserByPhone = (phone) => {
  return prisma.users.findUnique({ where: { phone } });
};

/** @param {string} userId */
export const findUserById = (userId) => {
  return prisma.users.findUnique({ where: { id: userId } });
};

/** @param {{ phone: string, roles: string[] }} data */
export const createUser = (data) => {
  return prisma.users.create({ data });
};

/**
 * @param {string} userId
 * @param {object} data
 */
export const updateUser = (userId, data) => {
  return prisma.users.update({ where: { id: userId }, data });
};

/** @param {string} userId */
export const createWorkerProfile = (userId) => {
  return prisma.worker_profiles.create({ data: { user_id: userId } });
};

/** @param {string} userId */
export const findWorkerProfile = (userId) => {
  return prisma.worker_profiles.findUnique({ where: { user_id: userId } });
};

/**
 * @param {{ phone: string, otp_code: string, purpose: string, expires_at: Date }} data
 */
export const createOtpRequest = (data) => {
  return prisma.otp_requests.create({ data });
};

/**
 * @param {string} phone
 * @param {string} otpCode
 * @param {string} purpose
 */
export const findValidOtp = (phone, otpCode, purpose) => {
  return prisma.otp_requests.findFirst({
    where: {
      phone,
      otp_code: otpCode,
      purpose,
      is_used: false,
      expires_at: { gt: new Date() },
      deleted_at: null,
    },
    orderBy: { created_at: "desc" },
  });
};

/** @param {string} otpId */
export const markOtpAsUsed = (otpId) => {
  return prisma.otp_requests.update({
    where: { id: otpId },
    data: { is_used: true },
  });
};

/**
 * @param {{ user_id: string, access_token: string, expires_at: Date, ip_address?: string, user_agent?: string }} data
 */
export const createSession = (data) => {
  return prisma.sessions.create({ data });
};

/**
 * @param {{ session_id: string, user_id: string, token: string, expires_at: Date }} data
 */
export const createRefreshToken = (data) => {
  return prisma.refresh_tokens.create({ data });
};

/** @param {string} token */
export const findRefreshToken = (token) => {
  return prisma.refresh_tokens.findUnique({
    where: { token },
    include: { users: true, sessions: true },
  });
};

/** @param {string} sessionId */
export const revokeSession = (sessionId) => {
  return prisma.$transaction([
    prisma.sessions.update({
      where: { id: sessionId },
      data: { status: "revoked" },
    }),
    prisma.refresh_tokens.updateMany({
      where: { session_id: sessionId },
      data: { is_revoked: true },
    }),
  ]);
};
