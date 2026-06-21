import { sendSuccess } from "../../utils/response.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as realtimeService from "./realtime.service.js";

export const createTicket = asyncHandler(async (req, res) => {
  const data = realtimeService.mintTicket(req.user.id);
  return sendSuccess(res, 201, "Socket ticket issued", data);
});
