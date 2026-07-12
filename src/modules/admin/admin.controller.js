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

export const listShiftPosts = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const { status, page, limit } = req.query;
  const data = await adminService.listShiftPosts({ status, page, limit });
  return sendSuccess(res, 200, "Shift-post queue fetched", data);
});

export const decideShiftPost = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const { decision, note } = req.body;
  const data = await adminService.decideShiftPost(req.user.id, req.params.shiftId, { decision, note });
  const message = decision === "approve" ? "Shift approved" : "Shift rejected";
  return sendSuccess(res, 200, message, data);
});

export const getDashboard = asyncHandler(async (req, res) => {
  const data = await adminService.getDashboard();
  return sendSuccess(res, 200, "Dashboard fetched", data);
});

export const getAnalytics = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const data = await adminService.getAnalytics({ days: req.query.days });
  return sendSuccess(res, 200, "Analytics fetched", data);
});

export const listUsers = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const { role, status, search, page, limit } = req.query;
  const data = await adminService.listUsers({ role, status, search, page, limit });
  return sendSuccess(res, 200, "Users fetched", data);
});

export const getUserDetail = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const data = await adminService.getUserDetail(req.params.userId);
  return sendSuccess(res, 200, "User fetched", data);
});

export const blockUser = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const { reason, severity } = req.body;
  const data = await adminService.blockUser(req.user.id, req.params.userId, { reason, severity });
  return sendSuccess(res, 200, "User blocked", data);
});

export const unblockUser = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const data = await adminService.unblockUser(req.user.id, req.params.userId, { note: req.body.note });
  return sendSuccess(res, 200, "User unblocked", data);
});

export const getSettings = asyncHandler(async (req, res) => {
  const data = await adminService.getSettings();
  return sendSuccess(res, 200, "Settings fetched", data);
});

export const updateSetting = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const data = await adminService.changeSetting(req.user.id, req.params.key, req.body.value);
  return sendSuccess(res, 200, "Setting updated", data);
});

export const resetSetting = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const data = await adminService.removeSettingOverride(req.user.id, req.params.key);
  return sendSuccess(res, 200, "Setting reset to default", data);
});
