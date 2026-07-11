import { prisma } from "../../db/index.js";

const ratingInclude = {
  shifts: { select: { id: true, title: true, shift_date: true } },
  users_ratings_rater_user_idTousers: { select: { id: true, full_name: true } },
  users_ratings_rated_user_idTousers: { select: { id: true, full_name: true } },
};

/**
 * @param {object} data
 * @param {import("@prisma/client").Prisma.TransactionClient} [client]
 */
export const createRating = (data, client = prisma) => {
  return client.ratings.create({ data, include: ratingInclude });
};

/** @param {{ userId: string, direction: "received"|"given", skip: number, take: number }} opts */
export const findUserRatings = ({ userId, direction, skip, take }) => {
  const where = { deleted_at: null };
  if (direction === "given") where.rater_user_id = userId;
  else where.rated_user_id = userId;
  return prisma.ratings.findMany({
    where,
    orderBy: { created_at: "desc" },
    skip,
    take,
    include: ratingInclude,
  });
};

/** @param {{ userId: string, direction: "received"|"given" }} opts */
export const countUserRatings = ({ userId, direction }) => {
  const where = { deleted_at: null };
  if (direction === "given") where.rater_user_id = userId;
  else where.rated_user_id = userId;
  return prisma.ratings.count({ where });
};

/**
 * Average overall score + count a user has received (their public reputation).
 * @param {string} ratedUserId
 */
export const summarizeReceived = async (ratedUserId) => {
  const agg = await prisma.ratings.aggregate({
    where: { rated_user_id: ratedUserId, deleted_at: null },
    _avg: { overall_score: true },
    _count: { overall_score: true },
  });
  return {
    average: agg._avg.overall_score ? Number(agg._avg.overall_score.toFixed(2)) : null,
    count: agg._count.overall_score,
  };
};

/**
 * Writes a recomputed reliability score onto the rated side's profile.
 * @param {"worker"|"business"} side
 * @param {string} userId
 * @param {number} score 0–5
 */
export const updateReliabilityScore = (side, userId, score) => {
  const model = side === "worker" ? prisma.worker_profiles : prisma.business_profiles;
  return model.updateMany({
    where: { user_id: userId },
    data: { reliability_score: score },
  });
};
