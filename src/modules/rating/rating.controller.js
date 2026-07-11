import { validationResult } from "express-validator";
import { sendSuccess, sendError } from "../../utils/response.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as ratingService from "./rating.service.js";

/** Rejects the request when validation rules failed. Returns true if handled. */
const failedValidation = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    sendError(res, 422, "Validation failed", errors.array());
    return true;
  }
  return false;
};

export const rate = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const { assignment_id, overall_score, punctuality_score, behavior_score, skill_score, review, is_anonymous } = req.body;
  const rating = await ratingService.rateCounterparty(req.user.id, {
    assignment_id, overall_score, punctuality_score, behavior_score, skill_score, review, is_anonymous,
  });
  return sendSuccess(res, 201, "Rating submitted", rating);
});

export const listMine = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const { direction, page, limit } = req.query;
  const data = await ratingService.listMyRatings(req.user.id, { direction, page, limit });
  return sendSuccess(res, 200, "Ratings fetched", data);
});
