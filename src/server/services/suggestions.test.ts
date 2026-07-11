import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import {
  dedupeSuggestions,
  keysFromSpecs,
  valueForKey,
} from "./suggestions";

/**
 * Tests for the suggestion aggregation logic.
 *
 * The service's public entrypoints (`specKeys`, `specValues`, `cities`) are
 * wrapped in `unstable_cache`, whose result is memoized per process and can't
 * be deterministically busted from a unit test. So we test the PURE building
 * blocks that carry all the real logic — `dedupeSuggestions` (distinct + fold +
 * cap), `keysFromSpecs` and `valueForKey` (specs Json aggregation) — both in
 * isolation AND driven by real rows we insert into the SEEDED database, which
 * proves the exact pipeline the service runs (fetch rows → aggregate → dedupe).
 *
 * Every row created here is tracked and deleted in `afterEach`, so re-runs stay
 * deterministic and the seed set is left untouched.
 */

const productIds = new Set<string>();
const customerIds = new Set<string>();

async function seedCategoryId(): Promise<string> {
  const category = await prisma.category.findFirst({ select: { id: true } });
  if (!category) throw new Error("seed missing: no category");
  return category.id;
}

afterEach(async () => {
  if (productIds.size > 0) {
    await prisma.product.deleteMany({ where: { id: { in: [...productIds] } } });
    productIds.clear();
  }
  if (customerIds.size > 0) {
    await prisma.customer.deleteMany({
      where: { id: { in: [...customerIds] } },
    });
    customerIds.clear();
  }
});

// --------------------------------------------------------------------------
// dedupeSuggestions — distinct, case-fold, trim, sort, cap
// --------------------------------------------------------------------------

describe("dedupeSuggestions", () => {
  it("folds case/whitespace variants to one, keeping first-seen casing", () => {
    const out = dedupeSuggestions(["Mumbai", " mumbai ", "MUMBAI"]);
    expect(out).toEqual(["Mumbai"]);
  });

  it("drops null/undefined/blank entries", () => {
    const out = dedupeSuggestions([null, undefined, "", "   ", "Delhi"]);
    expect(out).toEqual(["Delhi"]);
  });

  it("coerces non-strings and sorts case-insensitively", () => {
    const out = dedupeSuggestions(["banana", "Apple", 42, "cherry"]);
    expect(out).toEqual(["42", "Apple", "banana", "cherry"]);
  });

  it("caps the result at the given limit", () => {
    const many = Array.from({ length: 500 }, (_, i) => `city-${i}`);
    expect(dedupeSuggestions(many, 100)).toHaveLength(100);
  });
});

// --------------------------------------------------------------------------
// keysFromSpecs — top-level keys of a specs Json blob
// --------------------------------------------------------------------------

describe("keysFromSpecs", () => {
  it("returns top-level keys of a plain object", () => {
    expect(keysFromSpecs({ Capacity: "128 GB", Speed: "3200" }).sort()).toEqual(
      ["Capacity", "Speed"],
    );
  });

  it("returns [] for null, arrays and primitives", () => {
    expect(keysFromSpecs(null)).toEqual([]);
    expect(keysFromSpecs(["a"])).toEqual([]);
    expect(keysFromSpecs("Capacity")).toEqual([]);
    expect(keysFromSpecs(undefined)).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// valueForKey — case-insensitive value lookup within a specs blob
// --------------------------------------------------------------------------

describe("valueForKey", () => {
  it("matches the key case-insensitively and trims the value", () => {
    expect(valueForKey({ Capacity: " 128 GB " }, "capacity")).toBe("128 GB");
    expect(valueForKey({ RAM: "16GB" }, "ram")).toBe("16GB");
  });

  it("returns null when the key is absent, blank, or the value is empty", () => {
    expect(valueForKey({ Capacity: "128 GB" }, "Speed")).toBeNull();
    expect(valueForKey({ Capacity: "" }, "Capacity")).toBeNull();
    expect(valueForKey({ Capacity: "128 GB" }, "  ")).toBeNull();
    expect(valueForKey(null, "Capacity")).toBeNull();
  });
});

// --------------------------------------------------------------------------
// Integration: the exact fetch → aggregate → dedupe pipeline over real rows.
// --------------------------------------------------------------------------

describe("spec aggregation over real products", () => {
  it("produces DISTINCT keys across products, folding casing", async () => {
    const categoryId = await seedCategoryId();
    const stamp = Date.now();
    for (const [i, specs] of [
      { Capacity: "128 GB", Interface: "USB 3.0" },
      { capacity: "256 GB", Speed: "3200 MHz" }, // 'capacity' folds onto 'Capacity'
    ].entries()) {
      const p = await prisma.product.create({
        data: {
          categoryId,
          name: `Sug Prod ${stamp}-${i}`,
          slug: `sug-prod-${stamp}-${i}`,
          sku: `SUG-${stamp}-${i}`,
          price: 1000,
          specs,
        },
        select: { id: true },
      });
      productIds.add(p.id);
    }

    // Mirror the service's bounded scan, then aggregate with the tested helpers.
    const rows = await prisma.product.findMany({
      where: { id: { in: [...productIds] } },
      select: { specs: true },
    });
    const keys = dedupeSuggestions(rows.flatMap((r) => keysFromSpecs(r.specs)));

    // Distinct + folded: only ONE Capacity entry, plus Interface & Speed.
    const lower = keys.map((k) => k.toLowerCase());
    expect(lower.filter((k) => k === "capacity")).toHaveLength(1);
    expect(lower).toContain("interface");
    expect(lower).toContain("speed");
  });

  it("collects DISTINCT values used for a given key", async () => {
    const categoryId = await seedCategoryId();
    const stamp = Date.now();
    const specsList = [
      { Capacity: "128 GB" },
      { Capacity: "256 GB" },
      { capacity: "128 GB" }, // duplicate value, different key casing
      { Speed: "3200" }, // unrelated key
    ];
    for (const [i, specs] of specsList.entries()) {
      const p = await prisma.product.create({
        data: {
          categoryId,
          name: `SugVal Prod ${stamp}-${i}`,
          slug: `sugval-prod-${stamp}-${i}`,
          sku: `SUGVAL-${stamp}-${i}`,
          price: 1000,
          specs,
        },
        select: { id: true },
      });
      productIds.add(p.id);
    }

    const rows = await prisma.product.findMany({
      where: { id: { in: [...productIds] } },
      select: { specs: true },
    });
    const values = dedupeSuggestions(
      rows
        .map((r) => valueForKey(r.specs, "Capacity"))
        .filter((v): v is string => v !== null),
    );

    expect(values).toEqual(["128 GB", "256 GB"]);
  });
});

describe("city aggregation over real customers", () => {
  it("produces DISTINCT cities, folding casing/whitespace", async () => {
    const stamp = Date.now();
    const cities = ["Bengaluru", " bengaluru ", "Pune", null];
    for (const [i, city] of cities.entries()) {
      const c = await prisma.customer.create({
        data: {
          businessName: `Sug Biz ${stamp}-${i}`,
          contactName: `Sug Contact ${stamp}-${i}`,
          phone: `+9198${String(stamp).slice(-7)}${i}`,
          passwordHash: "x",
          city,
        },
        select: { id: true },
      });
      customerIds.add(c.id);
    }

    const rows = await prisma.customer.findMany({
      where: { id: { in: [...customerIds] }, city: { not: null } },
      select: { city: true },
    });
    const out = dedupeSuggestions(rows.map((r) => r.city));

    // Bengaluru folded to one; Pune present; null excluded.
    expect(out).toContain("Bengaluru");
    expect(out).toContain("Pune");
    expect(out.filter((c) => c.toLowerCase() === "bengaluru")).toHaveLength(1);
  });
});
