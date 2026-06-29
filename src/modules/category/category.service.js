import { logger } from "../../config/logger.js";
import * as categoryRepository from "./category.repository.js";

/**
 * Returns the list of active categories for selection (shift creation,
 * discovery filters).
 * @returns {Promise<Array<{ id: string, name: string, icon_url: string | null }>>}
 */
export const listCategories = async () => {
  const categories = await categoryRepository.findActiveCategories();
  logger.info({ count: categories.length }, "Listed active categories");
  return categories;
};
