import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import {
  ANON_VIEWER,
  type AdminViewer,
} from "@/server/types/viewer";
import {
  getBySlugForViewer,
  listByCategoryForViewer,
  listForViewer,
} from "@/server/dal/products";

/**
 * PRICE-GATE INVARIANT (Phase-2 gate).
 *
 * The single non-negotiable rule of MemoryDeals: an anonymous viewer must
 * never, by any storefront read path, receive a product price. Where the
 * per-function DAL tests (src/server/dal/products.test.ts) assert the *shape*
 * of the return value field-by-field, this file asserts the *invariant*
 * structurally: it walks the fully-serialized anon payload and fails if ANY
 * money-shaped key appears at ANY depth, and it cross-checks the concrete
 * paise values a price-authorised (admin) viewer sees against the anon output
 * to prove those exact numbers never leak through.
 *
 * These run against the SEEDED local MongoDB.
 */

const ADMIN_VIEWER: AdminViewer = {
  kind: "admin",
  adminId: "0000000000000000000000aa",
};

/** Keys that must never appear anywhere in an anon-facing product payload. */
const FORBIDDEN_KEYS = ["price", "mrp", "marginPct"] as const;

/**
 * Recursively collect every object key present in an arbitrary value. Arrays
 * are traversed by element; plain objects by own enumerable key. Dates and
 * primitives contribute nothing.
 */
function collectKeys(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (value === null || typeof value !== "object") return acc;
  if (value instanceof Date) return acc;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, acc);
    return acc;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    acc.add(key);
    collectKeys(nested, acc);
  }
  return acc;
}

/** Assert no forbidden money key exists anywhere in the payload. */
function assertNoMoneyKeys(payload: unknown): void {
  const keys = collectKeys(payload);
  for (const forbidden of FORBIDDEN_KEYS) {
    expect(keys.has(forbidden)).toBe(false);
  }
}

describe("price-gate invariant: anon never receives a price", () => {
  it("listForViewer(anon) leaks no money key at any depth", async () => {
    const products = await listForViewer(ANON_VIEWER, { take: 24 });
    expect(products.length).toBeGreaterThan(0);
    assertNoMoneyKeys(products);
    // Belt-and-braces: the serialized wire form also carries no money key.
    assertNoMoneyKeys(JSON.parse(JSON.stringify(products)));
  });

  it("getBySlugForViewer(anon) leaks no money key", async () => {
    const seed = await prisma.product.findFirst({
      where: { status: "ACTIVE", deletedAt: null },
      select: { slug: true },
      orderBy: { createdAt: "desc" },
    });
    expect(seed).not.toBeNull();

    const product = await getBySlugForViewer(ANON_VIEWER, seed!.slug);
    expect(product).not.toBeNull();
    assertNoMoneyKeys(product);
    assertNoMoneyKeys(JSON.parse(JSON.stringify(product)));
  });

  it("listByCategoryForViewer(anon) leaks no money key", async () => {
    const seed = await prisma.product.findFirst({
      where: { status: "ACTIVE", deletedAt: null },
      select: { categoryId: true },
    });
    expect(seed).not.toBeNull();

    const products = await listByCategoryForViewer(
      ANON_VIEWER,
      seed!.categoryId,
      { take: 24 },
    );
    expect(products.length).toBeGreaterThan(0);
    assertNoMoneyKeys(products);
  });

  it("the exact paise values an admin sees never appear in the anon payload", async () => {
    // Admin (price-authorised) view of the same storefront page.
    const priced = await listForViewer(ADMIN_VIEWER, { take: 24 });
    const anon = await listForViewer(ANON_VIEWER, { take: 24 });
    expect(priced.length).toBeGreaterThan(0);
    expect(priced.length).toBe(anon.length);

    // Collect the concrete money values that exist behind the gate.
    const secretPaise = new Set<number>();
    for (const p of priced) {
      secretPaise.add(p.price);
      if (p.mrp !== null) secretPaise.add(p.mrp);
    }
    expect(secretPaise.size).toBeGreaterThan(0);

    // None of those numbers may appear as a value anywhere in the anon wire form.
    const anonWire = JSON.stringify(JSON.parse(JSON.stringify(anon)));
    const anonNumbers = new Set<number>();
    const collectNumbers = (value: unknown): void => {
      if (typeof value === "number") anonNumbers.add(value);
      else if (Array.isArray(value)) value.forEach(collectNumbers);
      else if (value && typeof value === "object") {
        for (const nested of Object.values(value as Record<string, unknown>)) {
          collectNumbers(nested);
        }
      }
    };
    collectNumbers(JSON.parse(anonWire));

    for (const paise of secretPaise) {
      expect(anonNumbers.has(paise)).toBe(false);
    }
  });
});
