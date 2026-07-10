import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { ViewerContext } from "@/server/types/viewer";
import { assertAdmin } from "./guard";

/**
 * Category DAL. Categories carry no pricing, so there is no price gate here —
 * but `listAll` is admin-only because it exposes INACTIVE categories that the
 * storefront must never enumerate.
 */

/** Serialized category shape returned to callers (explicit allow-list). */
export interface CategoryDTO {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  sortOrder: number;
  status: import("@/lib/schemas/shared").EntityStatus;
  parentId: string | null;
}

const CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  image: true,
  sortOrder: true,
  status: true,
  parentId: true,
} satisfies Prisma.CategorySelect;

/** Storefront ordering: by explicit sortOrder, then name for stability. */
const CATEGORY_ORDER: Prisma.CategoryOrderByWithRelationInput[] = [
  { sortOrder: "asc" },
  { name: "asc" },
];

type CategoryRow = Prisma.CategoryGetPayload<{ select: typeof CATEGORY_SELECT }>;

function toCategoryDTO(row: CategoryRow): CategoryDTO {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    image: row.image ?? null,
    sortOrder: row.sortOrder,
    status: row.status,
    parentId: row.parentId ?? null,
  };
}

/** All ACTIVE categories, ordered for the storefront navigation. */
export async function listActive(): Promise<CategoryDTO[]> {
  const rows = await prisma.category.findMany({
    where: { status: "ACTIVE" },
    select: CATEGORY_SELECT,
    orderBy: CATEGORY_ORDER,
  });
  return rows.map(toCategoryDTO);
}

/**
 * A single ACTIVE category by slug, or null. Inactive categories are treated
 * as non-existent for the storefront.
 */
export async function getBySlug(slug: string): Promise<CategoryDTO | null> {
  const row = await prisma.category.findFirst({
    where: { slug, status: "ACTIVE" },
    select: CATEGORY_SELECT,
  });
  return row ? toCategoryDTO(row) : null;
}

/**
 * Every category regardless of status, for admin management. Throws
 * `ForbiddenError` for non-admin viewers before hitting the database.
 */
export async function listAll(viewer: ViewerContext): Promise<CategoryDTO[]> {
  assertAdmin(viewer);
  const rows = await prisma.category.findMany({
    select: CATEGORY_SELECT,
    orderBy: CATEGORY_ORDER,
  });
  return rows.map(toCategoryDTO);
}
