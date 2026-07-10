import { Prisma } from "@prisma/client";
import type { EntityStatus } from "@/lib/schemas/shared";
import { makeUniqueSlug } from "@/lib/slug";
import { prisma } from "@/server/db";

/**
 * Category service layer — the single place that mutates categories.
 *
 * These functions are transport-agnostic (no auth, no revalidation): the
 * server actions in `@/server/actions/categories` own authorization (assertAdmin),
 * input validation (zod) and audit/revalidation. Keeping the service pure of
 * those concerns makes the slug/reorder logic straightforward to unit-test
 * against the seeded database.
 *
 * Slugs are derived server-side from `name` and made unique across the whole
 * Category collection (slug is `@unique` in Mongo). A rename regenerates the
 * slug; if the new base collides we suffix `-2`, `-3`, … (see makeUniqueSlug).
 */

/** Serialized category shape returned by the service (explicit allow-list). */
export interface CategoryRecord {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  sortOrder: number;
  status: EntityStatus;
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

type CategoryRow = Prisma.CategoryGetPayload<{ select: typeof CATEGORY_SELECT }>;

function toRecord(row: CategoryRow): CategoryRecord {
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

/**
 * True when a category with `slug` already exists. When `exceptId` is given,
 * that row is ignored — so a category keeps its own slug on a no-op rename.
 */
async function slugTaken(slug: string, exceptId?: string): Promise<boolean> {
  const existing = await prisma.category.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!existing) return false;
  return existing.id !== exceptId;
}

/** Generates a collision-free slug from `name`, ignoring `exceptId`'s own slug. */
export function generateCategorySlug(
  name: string,
  exceptId?: string,
): Promise<string> {
  return makeUniqueSlug(name, (candidate) => slugTaken(candidate, exceptId));
}

export interface CreateCategoryData {
  name: string;
  image?: string | null;
  sortOrder: number;
  status: EntityStatus;
  parentId?: string | null;
}

/**
 * Creates a top-level category (or a sub-category when `parentId` is set).
 * The slug is derived from `name`. When `sortOrder` is not meaningfully set by
 * the caller (0) we append the new row to the end of its sibling group so new
 * categories don't all pile up at position 0.
 */
export async function createCategory(
  data: CreateCategoryData,
): Promise<CategoryRecord> {
  const parentId = data.parentId ?? null;
  const slug = await generateCategorySlug(data.name);
  const sortOrder =
    data.sortOrder > 0 ? data.sortOrder : await nextSortOrder(parentId);

  const row = await prisma.category.create({
    data: {
      name: data.name,
      slug,
      image: data.image ?? null,
      sortOrder,
      status: data.status,
      parentId,
    },
    select: CATEGORY_SELECT,
  });
  return toRecord(row);
}

/**
 * Convenience wrapper: create a sub-category under `parentId`. Rejects when
 * the parent does not exist or is itself a sub-category (categories are only
 * two levels deep: parent > child).
 */
export async function createSubCategory(
  parentId: string,
  data: Omit<CreateCategoryData, "parentId">,
): Promise<CategoryRecord> {
  const parent = await prisma.category.findUnique({
    where: { id: parentId },
    select: { id: true, parentId: true },
  });
  if (!parent) {
    throw new Error("Parent category not found");
  }
  if (parent.parentId) {
    throw new Error("Sub-categories cannot be nested more than one level deep");
  }
  return createCategory({ ...data, parentId });
}

export interface UpdateCategoryData {
  name?: string;
  image?: string | null;
  sortOrder?: number;
  status?: EntityStatus;
  parentId?: string | null;
}

/**
 * Partial update: only the provided fields change. Renaming (`name`) also
 * regenerates a unique slug (ignoring this row's own current slug so an
 * unchanged name is a no-op). Passing `parentId` re-parents the category and
 * is validated to keep the tree at most two levels deep.
 */
export async function updateCategory(
  id: string,
  data: UpdateCategoryData,
): Promise<CategoryRecord> {
  const current = await prisma.category.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!current) {
    throw new Error("Category not found");
  }

  const patch: Prisma.CategoryUpdateInput = {};

  if (data.name !== undefined && data.name !== current.name) {
    patch.name = data.name;
    patch.slug = await generateCategorySlug(data.name, id);
  } else if (data.name !== undefined) {
    patch.name = data.name;
  }
  if (data.image !== undefined) {
    patch.image = data.image;
  }
  if (data.sortOrder !== undefined) {
    patch.sortOrder = data.sortOrder;
  }
  if (data.status !== undefined) {
    patch.status = data.status;
  }
  if (data.parentId !== undefined) {
    await assertReparentable(id, data.parentId);
    patch.parent =
      data.parentId === null
        ? { disconnect: true }
        : { connect: { id: data.parentId } };
  }

  const row = await prisma.category.update({
    where: { id },
    data: patch,
    select: CATEGORY_SELECT,
  });
  return toRecord(row);
}

/**
 * Persists an explicit ordering: `idsInOrder[0]` gets sortOrder 0, the next 1,
 * and so on. Only the categories named in the list are touched — callers pass
 * one sibling group (a parent's children, or all top-level categories) at a
 * time. Silently ignores ids that don't exist. Runs as a single transaction so
 * the grid never observes a half-applied order.
 */
export async function reorderCategories(idsInOrder: string[]): Promise<void> {
  if (idsInOrder.length === 0) return;

  // Only reorder ids that actually exist, preserving the requested order.
  const existing = await prisma.category.findMany({
    where: { id: { in: idsInOrder } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((row) => row.id));
  const ordered = idsInOrder.filter((id) => existingIds.has(id));

  await prisma.$transaction(
    ordered.map((id, index) =>
      prisma.category.update({
        where: { id },
        data: { sortOrder: index },
      }),
    ),
  );
}

/**
 * Sets a category's status. INACTIVE hides the category and — because the
 * storefront DAL filters by `status: "ACTIVE"` — its products from the
 * storefront, without deleting anything. Returns the updated record.
 */
export async function setCategoryStatus(
  id: string,
  status: EntityStatus,
): Promise<CategoryRecord> {
  const row = await prisma.category.update({
    where: { id },
    data: { status },
    select: CATEGORY_SELECT,
  });
  return toRecord(row);
}

/**
 * Delete a category. Refuses (throws) when the category still holds products
 * or has sub-categories — those must be moved or removed first, so a delete can
 * never orphan a product or a child. Returns the number deleted (always 1).
 */
export async function deleteCategory(id: string): Promise<void> {
  const [productCount, childCount] = await Promise.all([
    prisma.product.count({ where: { categoryId: id, deletedAt: null } }),
    prisma.category.count({ where: { parentId: id } }),
  ]);
  if (productCount > 0) {
    throw new CategoryInUseError(
      `Cannot delete: ${productCount} product${productCount === 1 ? "" : "s"} still use this category. Move or delete them first.`,
    );
  }
  if (childCount > 0) {
    throw new CategoryInUseError(
      `Cannot delete: this category has ${childCount} sub-categor${childCount === 1 ? "y" : "ies"}. Remove them first.`,
    );
  }
  await prisma.category.delete({ where: { id } });
}

/** Thrown when a category cannot be deleted because it is still referenced. */
export class CategoryInUseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CategoryInUseError";
  }
}

/** Next free sortOrder within a sibling group (max + 1, or 0 when empty). */
async function nextSortOrder(parentId: string | null): Promise<number> {
  const last = await prisma.category.findFirst({
    where: { parentId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  return last ? last.sortOrder + 1 : 0;
}

/**
 * Guards a re-parent operation: a category may not be its own parent, the new
 * parent must exist and must itself be top-level, and a category that has
 * children may not become a sub-category (that would exceed two levels).
 */
async function assertReparentable(
  id: string,
  newParentId: string | null,
): Promise<void> {
  if (newParentId === null) return;
  if (newParentId === id) {
    throw new Error("A category cannot be its own parent");
  }
  const parent = await prisma.category.findUnique({
    where: { id: newParentId },
    select: { id: true, parentId: true },
  });
  if (!parent) {
    throw new Error("Parent category not found");
  }
  if (parent.parentId) {
    throw new Error("Sub-categories cannot be nested more than one level deep");
  }
  const childCount = await prisma.category.count({ where: { parentId: id } });
  if (childCount > 0) {
    throw new Error(
      "A category with sub-categories cannot become a sub-category itself",
    );
  }
}
