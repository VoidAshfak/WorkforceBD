import { prisma } from "../../db/index.js";

/**
 * Lists active, non-deleted categories ordered by name.
 * @returns {Promise<Array<{ id: string, name: string, icon_url: string | null }>>}
 */
export const findActiveCategories = () => {
  return prisma.categories.findMany({
    where: { is_active: true, deleted_at: null },
    select: { id: true, name: true, icon_url: true },
    orderBy: { name: "asc" },
  });
};
