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
// Writes — createReel / updateReel / deleteReel / reorderReels are added by the
// admin unit; keep the ReelInput import so the file type-checks meanwhile.
// ---------------------------------------------------------------------------
export type { ReelInput };
