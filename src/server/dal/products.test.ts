import { describe, expect, it } from "vitest";
import { isPaise } from "@/lib/money";
import {
  ANON_VIEWER,
  type AdminViewer,
  type CustomerViewer,
} from "@/server/types/viewer";
import { prisma } from "@/server/db";
import { ForbiddenError, isForbiddenError } from "./guard";
import {
  getBySlugForViewer,
  listByCategoryForViewer,
  listForAdminGrid,
  listForViewer,
} from "./products";

/**
 * Integration tests against the SEEDED local MongoDB. They prove the price
 * gate end-to-end: the shape of the returned objects (not just their values)
 * differs by viewer, and unauthorised viewers never receive a `price` key.
 */

const APPROVED_VIEWER: CustomerViewer = {
  kind: "customer",
  customerId: "000000000000000000000001",
  priceAccess: true,
  status: "APPROVED",
};

// Viewers that must NOT see prices — one per denial reason.
const DENIED_VIEWERS: ReadonlyArray<[string, CustomerViewer]> = [
  [
    "pending",
    {
      kind: "customer",
      customerId: "000000000000000000000002",
      priceAccess: false,
      status: "PENDING",
    },
  ],
  [
    "expired",
    {
      kind: "customer",
      customerId: "000000000000000000000003",
      priceAccess: false,
      status: "EXPIRED",
    },
  ],
  [
    "blocked",
    {
      kind: "customer",
      customerId: "000000000000000000000004",
      priceAccess: false,
      status: "BLOCKED",
    },
  ],
  [
    "rejected",
    {
      kind: "customer",
      customerId: "000000000000000000000005",
      priceAccess: false,
      status: "REJECTED",
    },
  ],
  // Belt-and-braces: even a forged priceAccess=true is rejected because
  // status !== APPROVED.
  [
    "approved-status-mismatch",
    {
      kind: "customer",
      customerId: "000000000000000000000006",
      priceAccess: true,
      status: "EXPIRED",
    },
  ],
];

const ADMIN_VIEWER: AdminViewer = {
  kind: "admin",
  adminId: "0000000000000000000000aa",
  name: "Test Admin",
  roleId: null,
  permissions: ["*"],
};

async function firstActiveSlug(): Promise<string> {
  const row = await prisma.product.findFirst({
    where: { status: "ACTIVE", deletedAt: null },
    select: { slug: true },
    orderBy: { createdAt: "desc" },
  });
  if (!row) throw new Error("seed missing: no active product");
  return row.slug;
}

describe("products DAL price gate", () => {
  it("anon viewer receives products with NO price key", async () => {
    const products = await listForViewer(ANON_VIEWER, { take: 5 });
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) {
      expect("price" in p).toBe(false);
      expect("mrp" in p).toBe(false);
      expect("marginPct" in p).toBe(false);
      // Public fields still present.
      expect(typeof p.slug).toBe("string");
      expect(typeof p.name).toBe("string");
    }
  });

  it("approved viewer receives integer-paise price", async () => {
    const products = await listForViewer(APPROVED_VIEWER, { take: 5 });
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) {
      expect("price" in p).toBe(true);
      // Narrow to priced shape.
      const priced = p as typeof p & { price: number };
      expect(Number.isInteger(priced.price)).toBe(true);
      expect(isPaise(priced.price)).toBe(true);
      expect(priced.price).toBeGreaterThan(0);
    }
  });

  it.each(DENIED_VIEWERS)(
    "%s viewer receives NO price key",
    async (_label, viewer) => {
      const products = await listForViewer(viewer, { take: 5 });
      expect(products.length).toBeGreaterThan(0);
      for (const p of products) {
        expect("price" in p).toBe(false);
        expect("mrp" in p).toBe(false);
      }
    },
  );

  it("getBySlugForViewer gates the same way", async () => {
    const slug = await firstActiveSlug();

    const anon = await getBySlugForViewer(ANON_VIEWER, slug);
    expect(anon).not.toBeNull();
    expect("price" in anon!).toBe(false);

    const approved = await getBySlugForViewer(APPROVED_VIEWER, slug);
    expect(approved).not.toBeNull();
    expect("price" in approved!).toBe(true);
    expect(isPaise((approved as { price: number }).price)).toBe(true);

    const pending = await getBySlugForViewer(DENIED_VIEWERS[0][1], slug);
    expect(pending).not.toBeNull();
    expect("price" in pending!).toBe(false);
  });

  it("getBySlugForViewer returns null for a missing slug", async () => {
    const missing = await getBySlugForViewer(
      APPROVED_VIEWER,
      "definitely-not-a-real-slug-zzz",
    );
    expect(missing).toBeNull();
  });

  it("listByCategoryForViewer gates prices per viewer", async () => {
    const anyProduct = await prisma.product.findFirst({
      where: { status: "ACTIVE", deletedAt: null },
      select: { categoryId: true },
    });
    expect(anyProduct).not.toBeNull();
    const categoryId = anyProduct!.categoryId;

    const anon = await listByCategoryForViewer(ANON_VIEWER, categoryId, {
      take: 5,
    });
    expect(anon.length).toBeGreaterThan(0);
    for (const p of anon) expect("price" in p).toBe(false);

    const approved = await listByCategoryForViewer(
      APPROVED_VIEWER,
      categoryId,
      { take: 5 },
    );
    expect(approved.length).toBeGreaterThan(0);
    for (const p of approved) expect("price" in p).toBe(true);
  });

  it("admin viewer sees prices via listForViewer", async () => {
    const products = await listForViewer(ADMIN_VIEWER, { take: 3 });
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) {
      expect("price" in p).toBe(true);
      expect(isPaise((p as { price: number }).price)).toBe(true);
    }
  });

  it("derives a whole-number marginPct when mrp exists", async () => {
    const products = await listForViewer(APPROVED_VIEWER, { take: 50 });
    const withMargin = products.find(
      (p) => (p as { marginPct: number | null }).marginPct !== null,
    ) as { price: number; mrp: number | null; marginPct: number | null } | undefined;
    if (withMargin) {
      expect(Number.isInteger(withMargin.marginPct)).toBe(true);
      expect(withMargin.marginPct).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("listForAdminGrid authorization", () => {
  it("throws ForbiddenError for anon", async () => {
    await expect(listForAdminGrid(ANON_VIEWER)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("throws ForbiddenError for a customer (even approved)", async () => {
    await expect(listForAdminGrid(APPROVED_VIEWER)).rejects.toSatisfy(
      isForbiddenError,
    );
  });

  it("returns priced rows for an admin", async () => {
    const rows = await listForAdminGrid(ADMIN_VIEWER, { take: 5 });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect("price" in r).toBe(true);
      expect(isPaise(r.price)).toBe(true);
    }
  });
});
