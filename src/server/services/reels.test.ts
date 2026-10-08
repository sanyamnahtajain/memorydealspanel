import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { resetSwrCache } from "@/server/cache/swr";
import type { ReelInput } from "@/lib/reels";
import {
  countReels,
  createReel,
  deleteReel,
  listLiveReels,
  listReelsForAdmin,
  reorderReels,
  searchProductsForReel,
  updateReel,
} from "./reels";

/**
 * Reels through the real create/read path — including the MongoDB
 * absent-vs-null trap, the memoised live read, and the hidden-product drop.
 *
 * The live read is cached under "reels-live" for a minute; every assertion
 * that follows a write resets that key first, exactly as the action layer
 * does in production.
 */

const UNIQ = `reeltest-${Date.now().toString(36)}`;

const created: string[] = [];
const productIds: string[] = [];
let categoryId = "";

beforeAll(async () => {
  const cat = await prisma.category.create({
    data: { name: `${UNIQ} Cat`, slug: `${UNIQ}-cat`, status: "ACTIVE" },
    select: { id: true },
  });
  categoryId = cat.id;
});

afterEach(async () => {
  if (created.length > 0) {
    await prisma.reel.deleteMany({ where: { id: { in: created } } });
    created.length = 0;
  }
  if (productIds.length > 0) {
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    productIds.length = 0;
  }
  resetSwrCache("reels-live");
});

afterAll(async () => {
  if (categoryId) {
    await prisma.category.deleteMany({ where: { id: categoryId } });
  }
});

const base: ReelInput = {
  videoUrl: "https://cdn.example.com/reels/clip.mp4",
  posterUrl: null,
  caption: `${UNIQ} caption`,
  instagramUrl: null,
  productId: null,
  durationSec: 12,
  sortOrder: 0,
  active: true,
};

async function make(over: Partial<ReelInput> = {}) {
  const reel = await createReel({ ...base, ...over });
  created.push(reel.id);
  return reel;
}

async function makeProduct(over: {
  n: string;
  status?: "ACTIVE" | "INACTIVE";
  deleted?: boolean;
  withImage?: boolean;
}) {
  const p = await prisma.product.create({
    data: {
      categoryId,
      name: `${UNIQ} product ${over.n}`,
      slug: `${UNIQ}-product-${over.n}`,
      sku: `${UNIQ}-SKU-${over.n}`,
      brand: "ReelBrand",
      price: 12300,
      stockStatus: "IN_STOCK",
      status: over.status ?? "ACTIVE",
      deletedAt: over.deleted ? new Date() : null,
      images: over.withImage
        ? [
            { url: "/seed/a.jpg", thumbUrl: null, sortOrder: 1, isPrimary: false },
            { url: "/seed/b.jpg", thumbUrl: "/seed/b-thumb.jpg", sortOrder: 0, isPrimary: true },
          ]
        : [],
    },
    select: { id: true, slug: true, name: true },
  });
  productIds.push(p.id);
  return p;
}

/** Fresh live read — the cache is what production has, so bypass it here. */
async function live() {
  resetSwrCache("reels-live");
  return listLiveReels();
}

describe("a reel reaches the storefront", () => {
  it("is created with an EXPLICIT deletedAt null, or it would be invisible", async () => {
    const reel = await make();
    const row = await prisma.reel.findFirst({
      where: { id: reel.id, deletedAt: null },
      select: { id: true },
    });
    expect(row).not.toBeNull();
    expect((await live()).some((r) => r.id === reel.id)).toBe(true);
  });

  it("carries caption, poster, Instagram link and duration — and NO price", async () => {
    const reel = await make({
      posterUrl: "/seed/poster.jpg",
      instagramUrl: "https://www.instagram.com/reel/abc123/",
      durationSec: 33,
    });
    const found = (await live()).find((r) => r.id === reel.id);
    expect(found).toBeDefined();
    expect(found?.caption).toBe(base.caption);
    expect(found?.posterUrl).toBe("/seed/poster.jpg");
    expect(found?.instagramUrl).toBe("https://www.instagram.com/reel/abc123/");
    expect(found?.durationSec).toBe(33);
    expect(found?.product).toBeNull();
    expect(Object.keys(found ?? {})).not.toContain("price");
  });

  it("orders by sortOrder, then newest first", async () => {
    const second = await make({ sortOrder: 2, caption: `${UNIQ} second` });
    const first = await make({ sortOrder: 1, caption: `${UNIQ} first` });
    const ids = (await live()).map((r) => r.id);
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
  });

  it("is memoised: the live read does not see a new row until the cache is reset", async () => {
    resetSwrCache("reels-live");
    await listLiveReels(); // prime
    const reel = await make();
    const stale = await listLiveReels();
    expect(stale.some((r) => r.id === reel.id)).toBe(false);
    expect((await live()).some((r) => r.id === reel.id)).toBe(true);
  });

  it("honours the limit argument", async () => {
    await make({ sortOrder: 0 });
    await make({ sortOrder: 1 });
    resetSwrCache("reels-live");
    const one = await listLiveReels(1);
    expect(one.length).toBe(1);
    expect((await listLiveReels(0)).length).toBe(0);
  });
});

describe("the product a reel sells", () => {
  it("resolves an active product to a price-free summary with its primary thumb", async () => {
    const product = await makeProduct({ n: "live", withImage: true });
    const reel = await make({ productId: product.id });
    const found = (await live()).find((r) => r.id === reel.id);
    expect(found?.product).toEqual({
      id: product.id,
      slug: product.slug,
      name: product.name,
      imageUrl: "/seed/b-thumb.jpg",
    });
    expect(Object.keys(found?.product ?? {})).not.toContain("price");
  });

  it("drops the product link when the product is INACTIVE — the reel still plays", async () => {
    const product = await makeProduct({ n: "inactive", status: "INACTIVE" });
    const reel = await make({ productId: product.id });
    const found = (await live()).find((r) => r.id === reel.id);
    expect(found).toBeDefined();
    expect(found?.product).toBeNull();
  });

  it("drops the product link when the product is soft-deleted", async () => {
    const product = await makeProduct({ n: "deleted", deleted: true });
    const reel = await make({ productId: product.id });
    const found = (await live()).find((r) => r.id === reel.id);
    expect(found?.product).toBeNull();
  });

  it("keeps the raw productId in the admin list so the admin can see the broken link", async () => {
    const product = await makeProduct({ n: "admin-hidden", status: "INACTIVE" });
    const reel = await make({ productId: product.id });
    const admin = (await listReelsForAdmin()).find((r) => r.id === reel.id);
    expect(admin?.productId).toBe(product.id);
    expect(admin?.product).toBeNull();
  });
});

describe("a reel that should NOT show", () => {
  it("is hidden when turned off, but still in the admin list", async () => {
    const reel = await make({ active: false });
    expect((await live()).some((r) => r.id === reel.id)).toBe(false);
    const admin = (await listReelsForAdmin()).find((r) => r.id === reel.id);
    expect(admin?.active).toBe(false);
  });

  it("disappears once removed, without destroying the row", async () => {
    const reel = await make();
    expect(await deleteReel(reel.id)).toBe(true);
    expect((await live()).some((r) => r.id === reel.id)).toBe(false);
    expect((await listReelsForAdmin()).some((r) => r.id === reel.id)).toBe(false);
    const row = await prisma.reel.findUnique({ where: { id: reel.id } });
    expect(row?.deletedAt).toBeInstanceOf(Date);
    // Deleting again is a no-op, not a crash.
    expect(await deleteReel(reel.id)).toBe(false);
  });
});

describe("editing", () => {
  it("updates every admin-settable field and returns the fresh shape", async () => {
    const product = await makeProduct({ n: "edit" });
    const reel = await make();
    const updated = await updateReel(reel.id, {
      ...base,
      caption: `${UNIQ} edited`,
      instagramUrl: "https://instagram.com/p/xyz/",
      productId: product.id,
      durationSec: 7,
      sortOrder: 5,
      active: false,
    });
    expect(updated).not.toBeNull();
    expect(updated?.caption).toBe(`${UNIQ} edited`);
    expect(updated?.instagramUrl).toBe("https://instagram.com/p/xyz/");
    expect(updated?.product?.id).toBe(product.id);
    expect(updated?.durationSec).toBe(7);
    expect(updated?.sortOrder).toBe(5);
    expect(updated?.active).toBe(false);
  });

  it("refuses to update a deleted reel", async () => {
    const reel = await make();
    await deleteReel(reel.id);
    expect(await updateReel(reel.id, base)).toBeNull();
  });

  it("reorders by the given id sequence and skips deleted ids", async () => {
    const a = await make({ sortOrder: 0, caption: `${UNIQ} a` });
    const b = await make({ sortOrder: 1, caption: `${UNIQ} b` });
    const c = await make({ sortOrder: 2, caption: `${UNIQ} c` });
    await deleteReel(c.id);

    const touched = await reorderReels([b.id, a.id, c.id]);
    expect(touched).toBe(2);

    const ids = (await live()).map((r) => r.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
    const rows = await prisma.reel.findMany({
      where: { id: { in: [a.id, b.id] } },
      select: { id: true, sortOrder: true },
    });
    expect(rows.find((r) => r.id === b.id)?.sortOrder).toBe(0);
    expect(rows.find((r) => r.id === a.id)?.sortOrder).toBe(1);
  });

  it("counts only undeleted reels", async () => {
    const before = await countReels();
    const reel = await make();
    expect(await countReels()).toBe(before + 1);
    await deleteReel(reel.id);
    expect(await countReels()).toBe(before);
  });
});

describe("searchProductsForReel", () => {
  it("needs two characters", async () => {
    expect(await searchProductsForReel("a")).toEqual([]);
    expect(await searchProductsForReel("  ")).toEqual([]);
  });

  it("finds active products by name or SKU, price-free, with the primary thumb", async () => {
    const product = await makeProduct({ n: "search", withImage: true });
    await makeProduct({ n: "search-off", status: "INACTIVE" });
    await makeProduct({ n: "search-gone", deleted: true });

    const byName = await searchProductsForReel(`${UNIQ} product search`);
    expect(byName.map((p) => p.id)).toEqual([product.id]);
    expect(byName[0]).toEqual({
      id: product.id,
      name: product.name,
      sku: `${UNIQ}-SKU-search`,
      slug: product.slug,
      imageUrl: "/seed/b-thumb.jpg",
    });

    const bySku = await searchProductsForReel(`${UNIQ}-SKU-search`);
    expect(bySku.some((p) => p.id === product.id)).toBe(true);
  });

  it("returns at most 8", async () => {
    for (let i = 0; i < 9; i++) {
      await makeProduct({ n: `many-${i}` });
    }
    const hits = await searchProductsForReel(`${UNIQ} product many`);
    expect(hits.length).toBe(8);
  });
});
