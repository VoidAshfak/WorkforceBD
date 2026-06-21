import { validationResult } from "express-validator";
import { sendSuccess, sendError } from "../../utils/response.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as workerService from "./worker.service.js";

export const getProfile = asyncHandler(async (req, res) => {
  const profile = await workerService.getProfile(req.user.id);
  return sendSuccess(res, 200, "Profile fetched", profile);
});

export const getSkills = asyncHandler(async (req, res) => {
  const skills = await workerService.getSkills();
  return sendSuccess(res, 200, "Skills fetched", skills);
});

export const getZones = asyncHandler(async (req, res) => {
  const zones = await workerService.getZones(req.query.city_id);
  return sendSuccess(res, 200, "Zones fetched", zones);
});

export const updateBasicInfo = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const { full_name, gender, date_of_birth, profile_picture, zone_ids } = req.body;
  const profile = await workerService.updateBasicInfo(req.user.id, {
    full_name,
    gender,
    date_of_birth: date_of_birth ? new Date(date_of_birth) : undefined,
    profile_picture,
    zone_ids,
  });
  return sendSuccess(res, 200, "Basic info saved", profile);
});

export const updateSkills = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const profile = await workerService.updateSkills(req.user.id, req.body.skill_ids);
  return sendSuccess(res, 200, "Skills saved", profile);
});

export const updateAvailability = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const { availability_days, availability_slots, zone_ids } = req.body;
  const profile = await workerService.updateAvailability(req.user.id, {
    availability_days,
    availability_slots,
    zone_ids,
  });
  return sendSuccess(res, 200, "Availability saved", profile);
});

export const submitDocuments = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const { nid_front_url, nid_back_url, selfie_url, student_id_url } = req.body;
  const profile = await workerService.submitDocuments(req.user.id, {
    nid_front_url,
    nid_back_url,
    selfie_url,
    ...(student_id_url && { student_id_url }),
  });
  return sendSuccess(res, 200, "Documents submitted. Pending admin verification.", profile);
});
