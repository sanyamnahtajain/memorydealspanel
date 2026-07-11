import { Prisma } from "@prisma/client";
import type { EntityStatus } from "@/lib/schemas/shared";
import { makeUniqueSlug } from "@/lib/slug";
import { prisma } from "@/server/db";

/**
 * Brand service layer — the single place that mutates brands.
 *
 * These functions are transport-agnostic (no auth, no revalidation): the
 * server actions in `@/server/actions/brands` own authorization (assertAdmin +
 * BRANDS_MANAGE), input validation (zod) and audit/revalidation. Keeping the
 * service pure of those concerns makes the slug/create logic straightforward to
 * unit-test against the seeded database.
 *
 * Slugs are derived server-side from `name` and made unique across the whole
 * Brand collection (slug is `@unique` in Mongo). A rename regenerates the slug;
 * if the new base collides we suffix `-2`, `-3`, … (see makeUniqueSlug).
 *
 * PRICE GATE: brand data is PUBLIC (name/slug/logo, no price). Nothing here
 * reads or emits price — the storefront can safely surface brands to
 * non-approved viewers.
 */

/** Serialized brand shape returned by the service (explicit allow-list). */
export interface BrandRecord {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  sortOrder: number;
  status: EntityStatus;
}

/** Lightweight option for product dropdowns — value/label only, no price. */
export interface BrandOption {
  id: string;
  name: string;
}

const BRAND_SELECT = {
  id: true,
  name: true,
  slug: true,
  logo: true,
  sortOrder: true,
  status: true,
} satisfies Prisma.BrandSelect;

type BrandRow = Prisma.BrandGetPayload<{ select: typeof BRAND_SELECT }>;

function toRecord(row: BrandRow): BrandRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logo: row.logo ?? null,
    sortOrder: row.sortOrder,
    status: row.status,
  };
}

/** A brand plus its live (non-deleted) product count, for the admin list. */
export interface BrandWithCount extends BrandRecord {
  productCount: number;
}

/**
 * Lists every brand (all statuses, including INACTIVE) with live product
 * counts, ordered for the admin grid. INACTIVE brands are never enumerated by
 * the storefront but must be visible to admins.
 */
export async function listBrands(): Promise<BrandWithCount[]> {
  const rows = await prisma.brand.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      ...BRAND_SELECT,
      _count: { select: { products: { where: { deletedAt: null } } } },
    },
  });
  return rows.map((row) => ({
    ...toRecord(row),
    productCount: row._count.products,
  }));
}

/**
 * Active brands as `{ id, name }` options for the product-form dropdown.
 * Deliberately minimal (no price, no logo) — this feeds a Select whose
 * `items` map value->label so the trigger shows the name, not the id.
 */
export async function listActiveBrands(): Promise<BrandOption[]> {
  const rows = await prisma.brand.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

/** Fetches a single brand by id, or null when it does not exist. */
export async function getBrand(id: string): Promise<BrandRecord | null> {
  const row = await prisma.brand.findUnique({
    where: { id },
    select: BRAND_SELECT,
  });
  return row ? toRecord(row) : null;
}

/**
 * True when a brand with `slug` already exists. When `exceptId` is given, that
 * row is ignored — so a brand keeps its own slug on a no-op rename.
 */
async function slugTaken(slug: string, exceptId?: string): Promise<boolean> {
  const existing = await prisma.brand.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!existing) return false;
  return existing.id !== exceptId;
}

/** Generates a collision-free slug from `name`, ignoring `exceptId`'s own slug. */
export function generateBrandSlug(
  name: string,
  exceptId?: string,
): Promise<string> {
  return makeUniqueSlug(name, (candidate) => slugTaken(candidate, exceptId));
}

/** Next free sortOrder across all brands (max + 1, or 0 when empty). */
async function nextSortOrder(): Promise<number> {
  const last = await prisma.brand.findFirst({
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  return last ? last.sortOrder + 1 : 0;
}

export interface CreateBrandData {
  name: string;
  logo?: string | null;
  sortOrder: number;
  status: EntityStatus;
}

/**
 * Creates a brand. The slug is derived from `name` and made unique. When
 * `sortOrder` is left at the default (0) the new brand is appended after
 * existing brands so fresh rows don't all pile up at position 0.
 *
 * `Brand.name` is `@unique`; a duplicate name surfaces as a typed
 * BrandInUseError so the action can show a friendly message.
 */
export async function createBrand(data: CreateBrandData): Promise<BrandRecord> {
  const slug = await generateBrandSlug(data.name);
  const sortOrder =
    data.sortOrder > 0 ? data.sortOrder : await nextSortOrder();

  try {
    const row = await prisma.brand.create({
      data: {
        name: data.name,
        slug,
        logo: data.logo ?? null,
        sortOrder,
        status: data.status,
      },
      select: BRAND_SELECT,
    });
    return toRecord(row);
  } catch (error) {
    throw mapUniqueNameError(error, data.name);
  }
}

export interface UpdateBrandData {
  name?: string;
  logo?: string | null;
  sortOrder?: number;
  status?: EntityStatus;
}

/**
 * Partial update: only the provided fields change. Renaming (`name`) also
 * regenerates a unique slug (ignoring this row's own current slug so an
 * unchanged name is a no-op).
 */
export async function updateBrand(
  id: string,
  data: UpdateBrandData,
): Promise<BrandRecord> {
  const current = await prisma.brand.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!current) {
    throw new Error("Brand not found");
  }

  const patch: Prisma.BrandUpdateInput = {};

  if (data.name !== undefined && data.name !== current.name) {
    patch.name = data.name;
    patch.slug = await generateBrandSlug(data.name, id);
  } else if (data.name !== undefined) {
    patch.name = data.name;
  }
  if (data.logo !== undefined) {
    patch.logo = data.logo;
  }
  if (data.sortOrder !== undefined) {
    patch.sortOrder = data.sortOrder;
  }
  if (data.status !== undefined) {
    patch.status = data.status;
  }

  try {
    const row = await prisma.brand.update({
      where: { id },
      data: patch,
      select: BRAND_SELECT,
    });
    return toRecord(row);
  } catch (error) {
    throw mapUniqueNameError(error, data.name ?? current.name);
  }
}

/**
 * Sets a brand's status. INACTIVE hides the brand and — because the storefront
 * filters by `status: "ACTIVE"` — its products from brand-scoped listings,
 * without deleting anything. Returns the updated record.
 */
export async function setBrandStatus(
  id: string,
  status: EntityStatus,
): Promise<BrandRecord> {
  const row = await prisma.brand.update({
    where: { id },
    data: { status },
    select: BRAND_SELECT,
  });
  return toRecord(row);
}

/**
 * Delete a brand. Refuses (throws BrandInUseError) when any product still
 * references it — those must be reassigned first, so a delete can never orphan
 * a product's brand link. Never silently nulls a product's brand.
 */
export async function deleteBrand(id: string): Promise<void> {
  const productCount = await prisma.product.count({
    where: { brandId: id, deletedAt: null },
  });
  if (productCount > 0) {
    throw new BrandInUseError(
      `Cannot delete: ${productCount} product${productCount === 1 ? "" : "s"} still use this brand. Reassign them to another brand first.`,
    );
  }
  await prisma.brand.delete({ where: { id } });
}

/** Thrown when a brand cannot be created/renamed/deleted due to a conflict. */
export class BrandInUseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrandInUseError";
  }
}

/**
 * Maps a Prisma unique-constraint violation on `name` to a friendly
 * BrandInUseError; re-throws anything else untouched.
 */
function mapUniqueNameError(error: unknown, name: string): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return new BrandInUseError(`A brand named "${name}" already exists.`);
  }
  return error;
}
