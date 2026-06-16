import { prisma } from "../../db/index.js";

// Maps a verification type to its Prisma model.
const models = {
  worker: prisma.worker_profiles,
  business: prisma.business_profiles,
};

// Columns returned for each profile type in the review queue / detail.
const selectByType = {
  worker: {
    id: true,
    user_id: true,
    full_name: true,
    verification_status: true,
    verification_note: true,
    nid_front_url: true,
    nid_back_url: true,
    selfie_url: true,
    student_id_url: true,
    created_at: true,
    updated_at: true,
    users: { select: { phone: true, roles: true } },
  },
  business: {
    id: true,
    user_id: true,
    business_name: true,
    business_type: true,
    verification_status: true,
    verification_note: true,
    trade_license_url: true,
    business_doc_url: true,
    created_at: true,
    updated_at: true,
    users: { select: { phone: true, roles: true } },
  },
};

/**
 * @param {{ type: "worker"|"business", status: string, skip: number, take: number }} opts
 */
export const findProfilesForReview = ({ type, status, skip, take }) => {
  return models[type].findMany({
    where: { verification_status: status, deleted_at: null },
    orderBy: { updated_at: "asc" }, // oldest waiting first
    skip,
    take,
    select: selectByType[type],
  });
};

/** @param {{ type: "worker"|"business", status: string }} opts */
export const countProfilesForReview = ({ type, status }) => {
  return models[type].count({ where: { verification_status: status, deleted_at: null } });
};

/**
 * @param {"worker"|"business"} type
 * @param {string} id
 */
export const findProfileById = (type, id) => {
  return models[type].findFirst({
    where: { id, deleted_at: null },
    select: selectByType[type],
  });
};

/**
 * @param {"worker"|"business"} type
 * @param {string} id
 * @param {object} data
 */
export const updateVerification = (type, id, data) => {
  return models[type].update({ where: { id }, data });
};

/** @param {object} data */
export const createNotification = (data) => prisma.notifications.create({ data });
