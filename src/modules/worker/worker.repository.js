import { prisma } from "../../db/index.js";

/** @param {string} userId */
export const findProfileByUserId = (userId) => {
  return prisma.worker_profiles.findUnique({
    where: { user_id: userId },
    include: {
      worker_skills: { include: { skills: true } },
      worker_preferred_zones: { include: { zones: true } },
    },
  });
};

/**
 * @param {string} profileId
 * @param {object} data
 */
export const updateProfile = (profileId, data) => {
  return prisma.worker_profiles.update({ where: { id: profileId }, data });
};

/**
 * Replaces all worker skills with the provided skill IDs.
 * @param {string} profileId
 * @param {string[]} skillIds
 */
export const replaceSkills = async (profileId, skillIds) => {
  return prisma.$transaction([
    prisma.worker_skills.deleteMany({ where: { worker_profile_id: profileId } }),
    prisma.worker_skills.createMany({
      data: skillIds.map((skill_id) => ({ worker_profile_id: profileId, skill_id })),
    }),
  ]);
};

/**
 * Replaces all preferred zones with the provided zone IDs.
 * @param {string} profileId
 * @param {string[]} zoneIds
 */
export const replacePreferredZones = async (profileId, zoneIds) => {
  return prisma.$transaction([
    prisma.worker_preferred_zones.deleteMany({ where: { worker_profile_id: profileId } }),
    prisma.worker_preferred_zones.createMany({
      data: zoneIds.map((zone_id) => ({ worker_profile_id: profileId, zone_id })),
    }),
  ]);
};

/** @param {string[]} zoneIds */
export const findZonesByIds = (zoneIds) => {
  return prisma.zones.findMany({ where: { id: { in: zoneIds }, is_active: true } });
};

/** @param {string[]} skillIds */
export const findSkillsByIds = (skillIds) => {
  return prisma.skills.findMany({ where: { id: { in: skillIds }, is_active: true } });
};
