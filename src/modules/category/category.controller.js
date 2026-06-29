import { sendSuccess } from "../../utils/response.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as categoryService from "./category.service.js";

export const listCategories = asyncHandler(async (_req, res) => {
  const data = await categoryService.listCategories();
  return sendSuccess(res, 200, "Categories fetched", data);
});
