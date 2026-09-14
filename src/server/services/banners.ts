import { prisma } from "@/server/db";
import {
  isBannerLive,
  type BannerInput,
  type BannerPlacement,
  type StorefrontBanner,
} from "@/lib/banners";

/**
 * Banner reads and writes. See src/lib/banners.ts for the model and the
 * scheduling contract.
 */

/** Hard cap per slot — a carousel nobody swipes past is wasted weight. */
export const MAX_BANNERS_PER_PLACEMENT = 8;

/** Everything the admin list needs. */
export interface AdminBanner {
  id: string;
  placement: string;
  imageUrl: string;
  mobileImageUrl: string | null;
  alt: string;
  href: string | null;
  sortOrder: number;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}

const ADMIN_SELECT = {
  id: true,
  placement: true,
  imageUrl: true,
  mobileImageUrl: true,
  alt: true,
  href: true,
  sortOrder: true,
  active: true,
  startsAt: true,
  endsAt: true,
} as const;

/**
 * The banners to render in a slot right now, in order.
 *
 * Scheduling is applied in JS rather than in the query: the window comparison
 * is against "now", and pushing it into Mongo would make the result
 * un-cacheable per request for no gain at this volume (a handful of rows).
 *
 * Fails to an EMPTY list, never throws — a broken banner table must not take
 * down the home page it sits on.
 */
export async function listLiveBanners(
  placement: BannerPlacement,
  now: Date = new Date(),
): Promise<StorefrontBanner[]> {
  try {
    const rows = await prisma.banner.findMany({
      where: { placement, active: true, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      take: MAX_BANNERS_PER_PLACEMENT,
      select: {
        id: true,
        imageUrl: true,
        mobileImageUrl: true,
        alt: true,
        href: true,
        startsAt: true,
        endsAt: true,
        active: true,
      },
    });

    return rows
      .filter((row) => isBannerLive(row, now))
      .map((row) => ({
        id: row.id,
        imageUrl: row.imageUrl,
        mobileImageUrl: row.mobileImageUrl ?? null,
        alt: row.alt,
        href: row.href ?? null,
      }));
  } catch (error) {
    console.error("[banners] live read failed:", error);
    return [];
  }
}

/** Every banner in a slot, live or not — the admin list. */
export async function listBannersForAdmin(
  placement?: BannerPlacement,
): Promise<AdminBanner[]> {
  const rows = await prisma.banner.findMany({
    where: { deletedAt: null, ...(placement ? { placement } : {}) },
    orderBy: [{ placement: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: ADMIN_SELECT,
  });
  return rows.map((row) => ({
    ...row,
    mobileImageUrl: row.mobileImageUrl ?? null,
    href: row.href ?? null,
    startsAt: row.startsAt ?? null,
    endsAt: row.endsAt ?? null,
  }));
}

export async function countBannersInPlacement(
  placement: BannerPlacement,
): Promise<number> {
  return prisma.banner.count({ where: { placement, deletedAt: null } });
}

export async function createBanner(input: BannerInput): Promise<AdminBanner> {
  const row = await prisma.banner.create({
    data: {
      placement: input.placement,
      imageUrl: input.imageUrl,
      mobileImageUrl: input.mobileImageUrl ?? null,
      alt: input.alt,
      href: input.href ?? null,
      sortOrder: input.sortOrder,
      active: input.active,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      // EXPLICIT null: on MongoDB an absent field does not match
      // `{ deletedAt: null }`, and every read above filters on exactly that —
      // a banner created without this would be invisible everywhere.
      deletedAt: null,
    },
    select: ADMIN_SELECT,
  });
  return { ...row, mobileImageUrl: row.mobileImageUrl ?? null, href: row.href ?? null };
}

export async function updateBanner(
  id: string,
  input: BannerInput,
): Promise<AdminBanner | null> {
  const existing = await prisma.banner.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!existing) return null;

  const row = await prisma.banner.update({
    where: { id },
    data: {
      placement: input.placement,
      imageUrl: input.imageUrl,
      mobileImageUrl: input.mobileImageUrl ?? null,
      alt: input.alt,
      href: input.href ?? null,
      sortOrder: input.sortOrder,
      active: input.active,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
    },
    select: ADMIN_SELECT,
  });
  return { ...row, mobileImageUrl: row.mobileImageUrl ?? null, href: row.href ?? null };
}

/**
 * Soft delete. The artwork is deliberately left in storage: an admin who
 * removes the wrong banner can be restored from the row, and an orphaned
 * object costs far less than deleting a file something else may reference.
 */
export async function deleteBanner(id: string): Promise<boolean> {
  const existing = await prisma.banner.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!existing) return false;
  await prisma.banner.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  return true;
}
