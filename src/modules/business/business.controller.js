import { validationResult } from "express-validator";
import { sendSuccess, sendError } from "../../utils/response.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as businessService from "./business.service.js";

/** Rejects the request when validation rules failed. Returns true if handled. */
const failedValidation = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    sendError(res, 422, "Validation failed", errors.array());
    return true;
  }
  return false;
};

/* ----------------------------- Profile ----------------------------- */

export const getProfile = asyncHandler(async (req, res) => {
  const profile = await businessService.getProfile(req.user.id);
  return sendSuccess(res, 200, "Profile fetched", profile);
});

export const createProfile = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const { business_name, business_type, manager_name, manager_phone, logo_url } = req.body;
  const profile = await businessService.createProfile(req.user.id, {
    business_name, business_type, manager_name, manager_phone, logo_url,
  });
  return sendSuccess(res, 201, "Business profile created", profile);
});

export const updateLocation = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const { zone_id, address, landmark } = req.body;
  const profile = await businessService.updateLocation(req.user.id, { zone_id, address, landmark });
  return sendSuccess(res, 200, "Location saved", profile);
});

export const submitDocuments = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const { trade_license_url, business_doc_url } = req.body;
  const profile = await businessService.submitDocuments(req.user.id, { trade_license_url, business_doc_url });
  return sendSuccess(res, 200, "Documents submitted. Pending admin verification.", profile);
});

export const updatePreferences = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const { meal_included, transport_support, female_friendly, uniform_required } = req.body;
  const profile = await businessService.updatePreferences(req.user.id, {
    meal_included, transport_support, female_friendly, uniform_required,
  });
  return sendSuccess(res, 200, "Preferences saved", profile);
});

/* ------------------------------ Wallet ----------------------------- */

export const getWallet = asyncHandler(async (req, res) => {
  const wallet = await businessService.getWallet(req.user.id);
  return sendSuccess(res, 200, "Wallet fetched", wallet);
});

export const topUpWallet = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const { amount, method } = req.body;
  const wallet = await businessService.topUpWallet(req.user.id, { amount, method });
  return sendSuccess(res, 200, "Wallet topped up", wallet);
});

/* ----------------------------- Dashboard --------------------------- */

export const getDashboard = asyncHandler(async (req, res) => {
  const data = await businessService.getDashboard(req.user.id);
  return sendSuccess(res, 200, "Dashboard fetched", data);
});

/* ------------------------------ Shifts ----------------------------- */

export const createShift = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const shift = await businessService.createShift(req.user.id, req.body);
  return sendSuccess(res, 201, shift.status === "draft" ? "Shift saved as draft" : "Shift submitted for admin review", shift);
});

export const listShifts = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const { status, page, limit } = req.query;
  const result = await businessService.listShifts(req.user.id, {
    status,
    page: page ? Number(page) : undefined,
    limit: limit ? Number(limit) : undefined,
  });
  return sendSuccess(res, 200, "Shifts fetched", result);
});

export const getShift = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const shift = await businessService.getShift(req.user.id, req.params.id);
  return sendSuccess(res, 200, "Shift fetched", shift);
});

export const updateShift = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const shift = await businessService.updateShift(req.user.id, req.params.id, req.body);
  return sendSuccess(res, 200, "Shift updated", shift);
});

export const publishShift = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const shift = await businessService.publishShift(req.user.id, req.params.id);
  return sendSuccess(res, 200, "Shift submitted for admin review", shift);
});

export const cancelShift = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const shift = await businessService.cancelShift(req.user.id, req.params.id, req.body.reason);
  return sendSuccess(res, 200, "Shift cancelled", shift);
});

export const getRoster = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const roster = await businessService.getShiftRoster(req.user.id, req.params.id);
  return sendSuccess(res, 200, "Roster fetched", roster);
});

/* ---------------------------- Applicants ---------------------------- */

export const listApplicants = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const { status, page, limit } = req.query;
  const result = await businessService.listApplicants(req.user.id, req.params.id, {
    status,
    page: page ? Number(page) : undefined,
    limit: limit ? Number(limit) : undefined,
  });
  return sendSuccess(res, 200, "Applicants fetched", result);
});

export const shortlistApplicant = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const application = await businessService.shortlistApplicant(req.user.id, req.params.id);
  return sendSuccess(res, 200, "Applicant shortlisted", application);
});

export const acceptApplicant = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const application = await businessService.acceptApplicant(req.user.id, req.params.id);
  return sendSuccess(res, 200, "Applicant hired", application);
});

export const rejectApplicant = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const application = await businessService.rejectApplicant(req.user.id, req.params.id);
  return sendSuccess(res, 200, "Applicant rejected", application);
});
