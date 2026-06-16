import { validationResult } from "express-validator";
import { sendSuccess, sendError } from "../../utils/response.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as shiftService from "./shift.service.js";

export const getDashboard = asyncHandler(async (req, res) => {
  const data = await shiftService.getDashboard(req.user.id);
  return sendSuccess(res, 200, "Dashboard fetched", data);
});

export const listShifts = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const { filter, zone_id, category_id, page, limit } = req.query;
  const data = await shiftService.listShifts(req.user.id, { filter, zone_id, category_id, page, limit });
  return sendSuccess(res, 200, "Shifts fetched", data);
});

export const getShift = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const shift = await shiftService.getShiftDetail(req.params.id);
  return sendSuccess(res, 200, "Shift fetched", shift);
});
