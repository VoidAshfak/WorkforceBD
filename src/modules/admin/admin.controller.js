import { validationResult } from "express-validator";
import { sendSuccess, sendError } from "../../utils/response.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as adminService from "./admin.service.js";

export const listVerifications = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const { type, status, page, limit } = req.query;
  const data = await adminService.listVerifications({ type, status, page, limit });
  return sendSuccess(res, 200, "Verification queue fetched", data);
});

export const getVerification = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const data = await adminService.getVerification(req.query.type, req.params.profileId);
  return sendSuccess(res, 200, "Profile fetched", data);
});

export const decideVerification = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const { type, decision, note } = req.body;
  const data = await adminService.decideVerification(req.user.id, req.params.profileId, { type, decision, note });
  const message = decision === "approve" ? "Profile verified" : "Profile rejected";
  return sendSuccess(res, 200, message, data);
});
