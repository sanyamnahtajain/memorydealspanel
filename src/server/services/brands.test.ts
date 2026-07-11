import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import {
  BrandInUseError,
  createBrand,
  generateBrandSlug,
  getBrand,
  listActiveBrands,
  setBrandStatus,
  updateBrand,
} from "./brands";

/**
 * Integration tests for the brand service against the SEEDED local MongoDB.
 * They exercise the logic that matters: slug derivation + uniqueness, append
 * sortOrder, unique-name conflict handling, status toggling and the active-only
 * dropdown source.
 *
 * Every test cleans up the rows it creates so re-runs stay deterministic and
 * the seed set (13 migrated brands) is left untouched.
 */

const created: string[] = [];

async function track<T extends { id: string }>(row: T): Promise<T> {
  created.push(row.id);
  return row;
}

afterEach(async () => {
  if (created.length === 0) return;
  await prisma.brand.deleteMany({ where: { id: { in: created } } });
  created.length = 0;
});

describe("generateBrandSlug", () => {
  it("slugifies a name to lowercase ascii with hyphens", async () => {
    const slug = await generateBrandSlug("Anker & PowerCore");
    expect(slug).toBe("anker-and-powercore");
  });

  it("suffixes to avoid collisions with an existing slug", async () => {
    const base = `Zzz Test Brand ${Date.now()}`;
    const first = await track(
      await createBrand({ name: base, sortOrder: 0, status: "ACTIVE" }),
    );
    // A fresh slug for the same base must not equal the taken one.
    const next = await generateBrandSlug(base);
    expect(next).not.toBe(first.slug);
    expect(next.startsWith(first.slug)).toBe(true);
  });

  it("ignores a brand's own slug via exceptId (no-op rename)", async () => {
    const brand = await track(
      await createBrand({
        name: `Keep Slug ${Date.now()}`,
        sortOrder: 0,
        status: "ACTIVE",
      }),
    );
    const same = await generateBrandSlug(brand.name, brand.id);
    expect(same).toBe(brand.slug);
  });
});

describe("createBrand", () => {
  it("derives a slug and defaults logo to null", async () => {
    const name = `Fresh Brand ${Date.now()}`;
    const brand = await track(
      await createBrand({ name, sortOrder: 0, status: "ACTIVE" }),
    );
    const { slugify } = await import("@/lib/slug");
    expect(brand.name).toBe(name);
    expect(brand.slug).toBe(slugify(name));
    expect(brand.logo).toBeNull();
    expect(brand.status).toBe("ACTIVE");
  });

  it("appends new brands after existing siblings when sortOrder is default", async () => {
    const stamp = Date.now();
    const first = await track(
      await createBrand({ name: `Appended A ${stamp}`, sortOrder: 0, status: "ACTIVE" }),
    );
    const second = await track(
      await createBrand({ name: `Appended B ${stamp}`, sortOrder: 0, status: "ACTIVE" }),
    );
    expect(second.sortOrder).toBeGreaterThan(first.sortOrder);
  });

  it("honors an explicit non-zero sortOrder", async () => {
    const brand = await track(
      await createBrand({
        name: `Explicit Order ${Date.now()}`,
        sortOrder: 99,
        status: "ACTIVE",
      }),
    );
    expect(brand.sortOrder).toBe(99);
  });

  it("rejects a duplicate name with a BrandInUseError", async () => {
    const name = `Dup Brand ${Date.now()}`;
    await track(await createBrand({ name, sortOrder: 0, status: "ACTIVE" }));
    await expect(
      createBrand({ name, sortOrder: 0, status: "ACTIVE" }),
    ).rejects.toBeInstanceOf(BrandInUseError);
  });
});

describe("updateBrand", () => {
  it("regenerates a unique slug on rename", async () => {
    const brand = await track(
      await createBrand({
        name: `Rename Me ${Date.now()}`,
        sortOrder: 0,
        status: "ACTIVE",
      }),
    );
    const target = `Renamed Fresh Brand ${Date.now()}`;
    const { slugify } = await import("@/lib/slug");
    const updated = await updateBrand(brand.id, { name: target });
    expect(updated.name).toBe(target);
    expect(updated.slug).toBe(slugify(target));
  });

  it("leaves the slug unchanged on a no-op rename", async () => {
    const brand = await track(
      await createBrand({
        name: `Stable Brand ${Date.now()}`,
        sortOrder: 0,
        status: "ACTIVE",
      }),
    );
    const updated = await updateBrand(brand.id, { name: brand.name });
    expect(updated.slug).toBe(brand.slug);
  });

  it("updates the logo when provided", async () => {
    const brand = await track(
      await createBrand({
        name: `Logo Brand ${Date.now()}`,
        sortOrder: 0,
        status: "ACTIVE",
      }),
    );
    const updated = await updateBrand(brand.id, {
      logo: "https://example.com/logo.png",
    });
    expect(updated.logo).toBe("https://example.com/logo.png");
  });
});

describe("setBrandStatus", () => {
  it("toggles ACTIVE <-> INACTIVE", async () => {
    const brand = await track(
      await createBrand({
        name: `Toggle Brand ${Date.now()}`,
        sortOrder: 0,
        status: "ACTIVE",
      }),
    );
    const off = await setBrandStatus(brand.id, "INACTIVE");
    expect(off.status).toBe("INACTIVE");
    const on = await setBrandStatus(brand.id, "ACTIVE");
    expect(on.status).toBe("ACTIVE");
  });
});

describe("getBrand", () => {
  it("returns null for a non-existent id", async () => {
    const missing = await getBrand("0123456789abcdef01234567");
    expect(missing).toBeNull();
  });

  it("returns the record for an existing brand", async () => {
    const brand = await track(
      await createBrand({
        name: `Get Brand ${Date.now()}`,
        sortOrder: 0,
        status: "ACTIVE",
      }),
    );
    const fetched = await getBrand(brand.id);
    expect(fetched?.id).toBe(brand.id);
    expect(fetched?.name).toBe(brand.name);
  });
});

describe("listActiveBrands", () => {
  it("includes ACTIVE brands and excludes INACTIVE ones, as {id,name}", async () => {
    const stamp = Date.now();
    const active = await track(
      await createBrand({ name: `Active DD ${stamp}`, sortOrder: 0, status: "ACTIVE" }),
    );
    const inactive = await track(
      await createBrand({ name: `Inactive DD ${stamp}`, sortOrder: 0, status: "INACTIVE" }),
    );
    const options = await listActiveBrands();
    const ids = new Set(options.map((o) => o.id));
    expect(ids.has(active.id)).toBe(true);
    expect(ids.has(inactive.id)).toBe(false);
    // Options are value/label only — no price/logo leaks into the dropdown.
    const opt = options.find((o) => o.id === active.id);
    expect(opt).toEqual({ id: active.id, name: active.name });
  });
});
