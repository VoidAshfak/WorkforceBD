import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";
import { createNotification } from "../notification/notification.service.js";
import * as paymentRepository from "../payment/payment.repository.js";
import * as ratingRepository from "./rating.repository.js";

// A rating is unlocked once the completion handshake finished (worker paid, or
// an admin ruled the dispute). Both directions: worker ↔ business.
const RATEABLE_COMPLETION_STATUSES = ["confirmed", "resolved"];

/**
 * Rates the counterparty of a completed assignment. The worker rates the
 * business, or the business rates the worker — whichever side the caller is.
 * One rating per direction per shift (DB unique constraint). Recomputes the
 * rated side's `reliability_score` (rolling average of received ratings).
 * @param {string} userId
 * @param {{ assignment_id: string, overall_score: number, punctuality_score?: number, behavior_score?: number, skill_score?: number, review?: string, is_anonymous?: boolean }} data
 */
export const rateCounterparty = async (userId, data) => {
  const assignment = await paymentRepository.findAssignmentWithContext(data.assignment_id);
  if (!assignment) throw new AppError("Assignment not found", 404);

  const workerUserId = assignment.worker_profiles.user_id;
  const businessUserId = assignment.shifts.business_profiles.user_id;

  let ratedUserId;
  let ratedSide;
  if (userId === workerUserId) {
    ratedUserId = businessUserId;
    ratedSide = "business";
  } else if (userId === businessUserId) {
    ratedUserId = workerUserId;
    ratedSide = "worker";
  } else {
    throw new AppError("You are not a party to this assignment", 403);
  }

  if (!RATEABLE_COMPLETION_STATUSES.includes(assignment.completion_status)) {
    throw new AppError("You can rate once the shift completion is confirmed", 409);
  }

  let rating;
  try {
    rating = await ratingRepository.createRating({
      shift_id: assignment.shift_id,
      assignment_id: assignment.id,
      rater_user_id: userId,
      rated_user_id: ratedUserId,
      overall_score: data.overall_score,
      punctuality_score: data.punctuality_score ?? null,
      behavior_score: data.behavior_score ?? null,
      skill_score: data.skill_score ?? null,
      review: data.review ?? null,
      is_anonymous: data.is_anonymous ?? false,
      created_by: userId,
    });
  } catch (err) {
    if (err.code === "P2002") throw new AppError("You have already rated this shift", 409);
    throw err;
  }

  // Reputation: reliability_score follows the rolling average of received ratings.
  const summary = await ratingRepository.summarizeReceived(ratedUserId);
  if (summary.average != null) {
    await ratingRepository.updateReliabilityScore(ratedSide, ratedUserId, summary.average);
  }

  await createNotification({
    user_id: ratedUserId,
    type: "in_app",
    priority: "normal",
    title: "New rating received",
    body: `You received a ${data.overall_score}★ rating for "${assignment.shifts.title}".`,
    data: { kind: "rating_received", shift_id: assignment.shift_id, rating_id: rating.id, overall_score: data.overall_score },
  });

  logger.info(`Rating created | rater=${userId} rated=${ratedUserId} shift=${assignment.shift_id} score=${data.overall_score}`);
  return rating;
};

/**
 * The caller's ratings, received (default) or given, plus their received summary.
 * @param {string} userId
 * @param {{ direction?: "received"|"given", page?: number, limit?: number }} query
 */
export const listMyRatings = async (userId, query) => {
  const direction = query.direction ?? "received";
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 10));
  const skip = (page - 1) * limit;

  const [items, total, summary] = await Promise.all([
    ratingRepository.findUserRatings({ userId, direction, skip, take: limit }),
    ratingRepository.countUserRatings({ userId, direction }),
    ratingRepository.summarizeReceived(userId),
  ]);

  // Anonymous ratings hide the rater from the rated side's view.
  const shaped = direction === "received"
    ? items.map((r) => (r.is_anonymous ? { ...r, users_ratings_rater_user_idTousers: null } : r))
    : items;

  return {
    items: shaped,
    summary,
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
};
