import { prisma } from "@/server/db";
import { swrCached } from "@/server/cache/swr";
import {
  HOME_REELS_LIMIT,
  MAX_REELS,
  type ReelInput,
  type ReelProductSummary,
  type StorefrontReel,
} from "@/lib/reels";

/**
 * Reel reads and writes. The model and the price-gate contract live in
 * src/lib/reels.ts.
 *
 * READ PATH: `listLiveReels` is what the public /reels feed and the ISR home
 * rail call. It must never embed a price and must never take the page down
 * with it — it fails to an EMPTY list, and the hot read is memoised with the
 * same stale-while-revalidate cache the home page's other rails use.
 */

/** Everything the admin list needs. */
export interface AdminReel {
  id: string;
  videoUrl: string;
  posterUrl: string | null;
  caption: string;
  instagramUrl: string | null;
  productId: string | null;
  product: ReelProductSummary | null;
  durationSec: number | null;
  sortOrder: number;
  active: boolean;
  publishedAt: Date;
}

const PUBLIC_SELECT = {
  id: true,
  videoUrl: true,
  posterUrl: true,
  caption: true,
  instagramUrl: true,
  productId: true,
  durationSec: true,
} as const;

const ADMIN_SELECT = {
  ...PUBLIC_SELECT,
  sortOrder: true,
  active: true,
  publishedAt: true,
} as const;

/**
 * Resolve the products a batch of reels point at — only ACTIVE, non-deleted
 * products, so a reel whose product was hidden quietly loses its CTA instead
 * of linking to a 404. Price-free projection.
 */
async function productSummaries(
  productIds: (string | null)[],
): Promise<Map<string, ReelProductSummary>> {
  const ids = [...new Set(productIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const rows = await prisma.product.findMany({
    where: { id: { in: ids }, status: "ACTIVE", deletedAt: null },
    select: { id: true, slug: true, name: true, images: true },
  });
  const map = new Map<string, ReelProductSummary>();
  for (const row of rows) {
    const primary =
      row.images.find((img) => img.isPrimary) ?? row.images[0] ?? null;
    map.set(row.id, {
      id: row.id,
      slug: row.slug,
      name: row.name,
      imageUrl: primary ? (primary.thumbUrl ?? primary.url) : null,
    });
  }
  return map;
}

function toStorefront(
  row: {
    id: string;
    videoUrl: string;
    posterUrl: string | null;
    caption: string;
    instagramUrl: string | null;
    productId: string | null;
    durationSec: number | null;
  },
  products: Map<string, ReelProductSummary>,
): StorefrontReel {
  return {
    id: row.id,
    videoUrl: row.videoUrl,
    posterUrl: row.posterUrl ?? null,
    caption: row.caption,
    instagramUrl: row.instagramUrl ?? null,
    durationSec: row.durationSec ?? null,
    product: row.productId ? (products.get(row.productId) ?? null) : null,
  };
}

async function readLiveReels(): Promise<StorefrontReel[]> {
  const rows = await prisma.reel.findMany({
    where: { active: true, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }],
    take: MAX_REELS,
    select: PUBLIC_SELECT,
  });
  const products = await productSummaries(rows.map((r) => r.productId));
  return rows.map((row) => toStorefront(row, products));
}

/**
 * Every live reel, in display order — the whole feed is small (≤ MAX_REELS),
 * so the page slices it rather than paginating the database. Cached
 * stale-first for a minute; fails to [] so a broken reel table can never
 * blank the home page.
 */
export async function listLiveReels(
  limit: number = MAX_REELS,
): Promise<StorefrontReel[]> {
  try {
    const all = await swrCached<StorefrontReel[]>("reels-live", readLiveReels, {
      ttlMs: 60_000,
      coldBudgetMs: 1_500,
      fallback: [],
      label: "reels",
    });
    return all.slice(0, Math.max(0, limit));
  } catch (error) {
    console.error("[reels] live read failed:", error);
    return [];
  }
}

/** The home rail's slice. */
export function listHomeReels(): Promise<StorefrontReel[]> {
  return listLiveReels(HOME_REELS_LIMIT);
}

/** Every reel, live or not — the admin list. */
export async function listReelsForAdmin(): Promise<AdminReel[]> {
  const rows = await prisma.reel.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }],
    select: ADMIN_SELECT,
  });
  const products = await productSummaries(rows.map((r) => r.productId));
  return rows.map((row) => ({
    id: row.id,
    videoUrl: row.videoUrl,
    posterUrl: row.posterUrl ?? null,
    caption: row.caption,
    instagramUrl: row.instagramUrl ?? null,
    productId: row.productId ?? null,
    product: row.productId ? (products.get(row.productId) ?? null) : null,
    durationSec: row.durationSec ?? null,
    sortOrder: row.sortOrder,
    active: row.active,
    publishedAt: row.publishedAt,
  }));
}

export async function countReels(): Promise<number> {
  return prisma.reel.count({ where: { deletedAt: null } });
}

// ---------------------------------------------------------------------------
// Writes — the admin unit. Every write that changes what the storefront shows
// is followed, in the action layer, by resetSwrCache("reels-live") plus the
// ISR revalidations; the service itself stays a thin, testable data layer.
// ---------------------------------------------------------------------------

/** The columns an admin may set — everything except the identity/lifecycle fields. */
function writeData(input: ReelInput) {
  return {
    videoUrl: input.videoUrl,
    posterUrl: input.posterUrl ?? null,
    caption: input.caption,
    instagramUrl: input.instagramUrl ?? null,
    productId: input.productId ?? null,
    durationSec: input.durationSec ?? null,
    sortOrder: input.sortOrder,
    active: input.active,
  };
}

async function toAdmin(row: {
  id: string;
  videoUrl: string;
  posterUrl: string | null;
  caption: string;
  instagramUrl: string | null;
  productId: string | null;
  durationSec: number | null;
  sortOrder: number;
  active: boolean;
  publishedAt: Date;
}): Promise<AdminReel> {
  const products = await productSummaries([row.productId]);
  return {
    id: row.id,
    videoUrl: row.videoUrl,
    posterUrl: row.posterUrl ?? null,
    caption: row.caption,
    instagramUrl: row.instagramUrl ?? null,
    productId: row.productId ?? null,
    product: row.productId ? (products.get(row.productId) ?? null) : null,
    durationSec: row.durationSec ?? null,
    sortOrder: row.sortOrder,
    active: row.active,
    publishedAt: row.publishedAt,
  };
}

export async function createReel(input: ReelInput): Promise<AdminReel> {
  const row = await prisma.reel.create({
    data: {
      ...writeData(input),
      // EXPLICIT null: on MongoDB an absent field does not match
      // `{ deletedAt: null }`, and every read above filters on exactly that —
      // a reel created without this would be invisible everywhere.
      deletedAt: null,
    },
    select: ADMIN_SELECT,
  });
  return toAdmin(row);
}

export async function updateReel(
  id: string,
  input: ReelInput,
): Promise<AdminReel | null> {
  const existing = await prisma.reel.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!existing) return null;
  const row = await prisma.reel.update({
    where: { id },
    data: writeData(input),
    select: ADMIN_SELECT,
  });
  return toAdmin(row);
}

/**
 * Soft delete. The clip is deliberately left in storage: an admin who removes
 * the wrong reel can be restored from the row, and an orphaned object costs
 * far less than deleting a file something else may still reference.
 */
export async function deleteReel(id: string): Promise<boolean> {
  const existing = await prisma.reel.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!existing) return false;
  await prisma.reel.update({ where: { id }, data: { deletedAt: new Date() } });
  return true;
}

/**
 * Persist a new display order. Sequential, not a transaction: a half-applied
 * reorder is cosmetic and the next save fixes it — nothing about money depends
 * on it. Ids that are unknown or already deleted are skipped, not an error.
 * Returns how many rows were touched.
 */
export async function reorderReels(orderedIds: string[]): Promise<number> {
  let touched = 0;
  for (const [index, id] of orderedIds.entries()) {
    const res = await prisma.reel.updateMany({
      where: { id, deletedAt: null },
      data: { sortOrder: index },
    });
    touched += res.count;
  }
  return touched;
}

/** The shape the admin product picker shows. Price-free by construction. */
export interface ReelProductPick {
  id: string;
  name: string;
  sku: string;
  slug: string;
  imageUrl: string | null;
}

export const REEL_PRODUCT_PICK_LIMIT = 8;

/**
 * Products an admin may attach to a reel: active, not deleted, matched on
 * name / SKU / brand. Mirrors searchProductsForOrderEdit's query shape minus
 * the stock filter (a reel can be shot before the stock lands).
 */
export async function searchProductsForReel(
  query: string,
): Promise<ReelProductPick[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const rows = await prisma.product.findMany({
    where: {
      deletedAt: null,
      status: "ACTIVE",
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { sku: { contains: q, mode: "insensitive" } },
        { brand: { contains: q, mode: "insensitive" } },
      ],
    },
    take: REEL_PRODUCT_PICK_LIMIT,
    orderBy: { name: "asc" },
    select: { id: true, name: true, sku: true, slug: true, images: true },
  });
  return rows.map((p) => {
    const primary = p.images.find((i) => i.isPrimary) ?? p.images[0] ?? null;
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      slug: p.slug,
      imageUrl: primary ? (primary.thumbUrl ?? primary.url) : null,
    };
  });
}

export type { ReelInput };
