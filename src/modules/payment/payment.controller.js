import { validationResult } from "express-validator";
import { sendSuccess, sendError } from "../../utils/response.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as paymentService from "./payment.service.js";

/** Rejects the request when validation rules failed. Returns true if handled. */
const failedValidation = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    sendError(res, 422, "Validation failed", errors.array());
    return true;
  }
  return false;
};

/* ------------------------------ Wallet ----------------------------- */

export const getWallet = asyncHandler(async (req, res) => {
  const wallet = await paymentService.getWallet(req.user.id);
  return sendSuccess(res, 200, "Wallet fetched", wallet);
});

export const listTransactions = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const { page, limit } = req.query;
  const data = await paymentService.listTransactions(req.user.id, { page, limit });
  return sendSuccess(res, 200, "Transactions fetched", data);
});

/* ------------------------------ Payouts ---------------------------- */

export const requestPayout = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const { amount, method, account_number, account_name } = req.body;
  const payout = await paymentService.requestPayout(req.user.id, { amount, method, account_number, account_name });
  return sendSuccess(res, 201, "Payout requested", payout);
});

export const listPayouts = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const { status, page, limit } = req.query;
  const data = await paymentService.listPayouts(req.user.id, { status, page, limit });
  return sendSuccess(res, 200, "Payouts fetched", data);
});

/* ---------------------------- Settlement --------------------------- */

export const completeShift = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const data = await paymentService.completeShift(req.user.id, req.params.shiftId);
  return sendSuccess(res, 200, "Shift marked completed", data);
});

export const settleShift = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const data = await paymentService.settleShift(req.user.id, req.params.shiftId);
  return sendSuccess(res, 200, "Shift settled and workers paid", data);
});

/* ------------------------ Payout processing ------------------------ */

export const listPayoutQueue = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const { status, page, limit } = req.query;
  const data = await paymentService.listPayoutQueue({ status, page, limit });
  return sendSuccess(res, 200, "Payout queue fetched", data);
});

export const processPayout = asyncHandler(async (req, res) => {
  if (failedValidation(req, res)) return;
  const { decision, failure_reason } = req.body;
  const data = await paymentService.processPayout(req.user.id, req.params.payoutId, { decision, failure_reason });
  const message = decision === "approve" ? "Payout marked sent" : "Payout rejected and refunded";
  return sendSuccess(res, 200, message, data);
});
