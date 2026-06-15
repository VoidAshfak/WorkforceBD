import { validationResult } from "express-validator";
import { sendSuccess, sendError } from "../../utils/response.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { generateUploadSignature } from "./upload.service.js";

export const presign = asyncHandler((req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, "Validation failed", errors.array());

  const { purpose } = req.body;
  const result = generateUploadSignature(purpose, req.user.id);
  return sendSuccess(res, 200, "Upload signature generated", result);
});
