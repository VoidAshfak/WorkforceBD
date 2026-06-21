import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";
import * as workerRepository from "./worker.repository.js";

/**
 * Resolves worker_profile for the requesting user. Throws 404 if not found.
 * @param {string} userId
 */
const getProfileOrThrow = async (userId) => {
  const profile = await workerRepository.findProfileByUserId(userId);
  if (!profile) throw new AppError("Worker profile not found", 404);
  return profile;
};

/**
 * Returns full worker profile with skills and zones.
 * @param {string} userId
 */
export const getProfile = (userId) => getProfileOrThrow(userId);

/** Returns active skills for onboarding selection. */
export const getSkills = () => workerRepository.findActiveSkills();

/**
 * Returns active zones for onboarding selection, optionally filtered by city.
 * @param {string} [cityId]
 */
export const getZones = (cityId) => workerRepository.findActiveZones(cityId);

/**
 * Step 1 — saves basic info: name, gender, DOB, profile picture, preferred zones.
 * @param {string} userId
 * @param {{ full_name: string, gender?: string, date_of_birth?: string, profile_picture?: string, zone_ids?: string[] }} data
 */
export const updateBasicInfo = async (userId, data) => {
  const profile = await getProfileOrThrow(userId);
  const { zone_ids, ...profileData } = data;

  if (zone_ids?.length) {
    const validZones = await workerRepository.findZonesByIds(zone_ids);
    if (validZones.length !== zone_ids.length) throw new AppError("One or more zone IDs are invalid", 400);
    await workerRepository.replacePreferredZones(profile.id, zone_ids);
  }

  const updated = await workerRepository.updateProfile(profile.id, profileData);
  logger.info(`Worker basic info updated | userId=${userId}`);
  return updated;
};

/**
 * Step 2 — replaces worker skills.
 * @param {string} userId
 * @param {string[]} skillIds
 */
export const updateSkills = async (userId, skillIds) => {
  const profile = await getProfileOrThrow(userId);

  const validSkills = await workerRepository.findSkillsByIds(skillIds);
  if (validSkills.length !== skillIds.length) throw new AppError("One or more skill IDs are invalid", 400);

  await workerRepository.replaceSkills(profile.id, skillIds);
  logger.info(`Worker skills updated | userId=${userId} count=${skillIds.length}`);
  return workerRepository.findProfileByUserId(userId);
};

/**
 * Step 3 — saves availability days, time slots and preferred zones.
 * @param {string} userId
 * @param {{ availability_days: string[], availability_slots: string[], zone_ids?: string[] }} data
 */
export const updateAvailability = async (userId, data) => {
  const profile = await getProfileOrThrow(userId);
  const { zone_ids, availability_days, availability_slots } = data;

  if (zone_ids?.length) {
    const validZones = await workerRepository.findZonesByIds(zone_ids);
    if (validZones.length !== zone_ids.length) throw new AppError("One or more zone IDs are invalid", 400);
    await workerRepository.replacePreferredZones(profile.id, zone_ids);
  }

  const updated = await workerRepository.updateProfile(profile.id, { availability_days, availability_slots });
  logger.info(`Worker availability updated | userId=${userId} days=${availability_days} slots=${availability_slots}`);
  return updated;
};

/**
 * Step 4 — stores document URLs and moves verification_status to 'pending'.
 * Actual file upload handled by frontend (cloud storage); backend receives URLs.
 * @param {string} userId
 * @param {{ nid_front_url: string, nid_back_url: string, selfie_url: string, student_id_url?: string }} data
 */
export const submitDocuments = async (userId, data) => {
  const profile = await getProfileOrThrow(userId);

  if (profile.verification_status === "verified") throw new AppError("Profile already verified", 400);

  const updated = await workerRepository.updateProfile(profile.id, {
    ...data,
    verification_status: "pending",
  });
  logger.info(`Worker documents submitted | userId=${userId} status=pending`);
  return updated;
};
