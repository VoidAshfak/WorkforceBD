import { validationResult } from "express-validator";
import { sendSuccess, sendError } from "../../utils/response.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as applicationService from "./application.service.js";

export const apply = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const { shift_id, note } = req.body;
  const application = await applicationService.applyToShift(req.user.id, { shift_id, note });
  return sendSuccess(res, 201, "Applied successfully", application);
});

export const listMyApplications = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const { status, page, limit } = req.query;
  const data = await applicationService.listMyApplications(req.user.id, { status, page, limit });
  return sendSuccess(res, 200, "Applications fetched", data);
});

export const withdraw = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const application = await applicationService.withdrawApplication(req.user.id, req.params.id);
  return sendSuccess(res, 200, "Application withdrawn", application);
});
