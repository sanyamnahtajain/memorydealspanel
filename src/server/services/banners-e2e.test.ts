import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createBanner, deleteBanner, listLiveBanners } from "./banners";
import type { BannerInput } from "@/lib/banners";

/**
 * Banners through the real create/read path — including the MongoDB
 * absent-vs-null trap that would make every banner invisible.
 */

const created: string[] = [];

afterEach(async () => {
  if (created.length > 0) {
    await prisma.banner.deleteMany({ where: { id: { in: created } } });
    created.length = 0;
  }
});

const base: BannerInput = {
  placement: "HOME_HERO",
  imageUrl: "/banners/sale.jpg",
  mobileImageUrl: null,
  alt: "Diwali sale",
  href: "/c/chargers",
  sortOrder: 0,
  active: true,
  startsAt: null,
  endsAt: null,
};

async function make(over: Partial<BannerInput> = {}) {
  const banner = await createBanner({ ...base, ...over });
  created.push(banner.id);
  return banner;
}

describe("a banner reaches the storefront", () => {
  it("is created with an EXPLICIT deletedAt null, or it would be invisible", async () => {
    // The trap: on MongoDB an absent field does not match `{ deletedAt: null }`,
    // and every read filters on exactly that. A banner saved without it would
    // save successfully and then never appear anywhere.
    const banner = await make();
    const row = await prisma.banner.findFirst({
      where: { id: banner.id, deletedAt: null },
      select: { id: true },
    });
    expect(row).not.toBeNull();

    const live = await listLiveBanners("HOME_HERO");
    expect(live.some((b) => b.id === banner.id)).toBe(true);
  });

  it("carries its link and alt text through to the storefront shape", async () => {
    const banner = await make({ alt: "20% off cables", href: "/search?q=cable" });
    const live = await listLiveBanners("HOME_HERO");
    const found = live.find((b) => b.id === banner.id);
    expect(found?.alt).toBe("20% off cables");
    expect(found?.href).toBe("/search?q=cable");
  });

  it("orders by sortOrder", async () => {
    const second = await make({ sortOrder: 2, alt: "second" });
    const first = await make({ sortOrder: 1, alt: "first" });
    const live = await listLiveBanners("HOME_HERO");
    const ids = live.map((b) => b.id);
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
  });

  it("stays out of a slot it wasn't placed in", async () => {
    const banner = await make({ placement: "HOME_MID" });
    const hero = await listLiveBanners("HOME_HERO");
    expect(hero.some((b) => b.id === banner.id)).toBe(false);
    const mid = await listLiveBanners("HOME_MID");
    expect(mid.some((b) => b.id === banner.id)).toBe(true);
  });
});

describe("a banner that should NOT show", () => {
  it("is hidden when turned off", async () => {
    const banner = await make({ active: false });
    const live = await listLiveBanners("HOME_HERO");
    expect(live.some((b) => b.id === banner.id)).toBe(false);
  });

  it("is hidden before its start and after its end", async () => {
    const future = await make({
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      alt: "future",
    });
    const past = await make({
      endsAt: new Date(Date.now() - 86_400_000).toISOString(),
      alt: "past",
    });
    const live = await listLiveBanners("HOME_HERO");
    expect(live.some((b) => b.id === future.id)).toBe(false);
    expect(live.some((b) => b.id === past.id)).toBe(false);
  });

  it("appears once its scheduled moment arrives", async () => {
    const startsAt = new Date(Date.now() + 60_000);
    const banner = await make({ startsAt: startsAt.toISOString(), alt: "soon" });
    expect(
      (await listLiveBanners("HOME_HERO")).some((b) => b.id === banner.id),
    ).toBe(false);
    // Same row, a later clock — no rewrite needed for it to go live.
    const later = new Date(startsAt.getTime() + 1000);
    expect(
      (await listLiveBanners("HOME_HERO", later)).some((b) => b.id === banner.id),
    ).toBe(true);
  });

  it("disappears once removed, without destroying the row", async () => {
    const banner = await make();
    expect(await deleteBanner(banner.id)).toBe(true);
    expect(
      (await listLiveBanners("HOME_HERO")).some((b) => b.id === banner.id),
    ).toBe(false);
    // Soft delete: the row (and its artwork) survive for recovery.
    const row = await prisma.banner.findUnique({ where: { id: banner.id } });
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });
});
