import { validationResult } from "express-validator";
import { sendSuccess, sendError } from "../../utils/response.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as disputeService from "./dispute.service.js";

/** Rejects the request when validation rules failed. Returns true if handled. */
const failedValidation = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    sendError(res, 422, "Validation failed", errors.array());
    return true;
  }
  return false;
};

export const raise = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const { assignment_id, description } = req.body;
  const dispute = await disputeService.raiseDispute(req.user.id, { assignment_id, description });
  return sendSuccess(res, 201, "Dispute raised — payment frozen until an admin resolves it", dispute);
});

export const listMine = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const { status, page, limit } = req.query;
  const data = await disputeService.listMyDisputes(req.user.id, { status, page, limit });
  return sendSuccess(res, 200, "Disputes fetched", data);
});

export const listQueue = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const { status, page, limit } = req.query;
  const data = await disputeService.listDisputeQueue({ status, page, limit });
  return sendSuccess(res, 200, "Dispute queue fetched", data);
});

export const resolve = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const { decision, amount, resolution_note } = req.body;
  const dispute = await disputeService.resolveDispute(req.user.id, req.params.id, { decision, amount, resolution_note });
  return sendSuccess(res, 200, "Dispute resolved", dispute);
});
