import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import {
  createCategory,
  createSubCategory,
  generateCategorySlug,
  reorderCategories,
  setCategoryStatus,
  updateCategory,
} from "./categories";

/**
 * Integration tests for the category service against the SEEDED local MongoDB.
 * They exercise the pure-ish logic that matters: slug derivation + uniqueness,
 * reorder normalization, status toggling, and the two-level parent guard.
 *
 * Every test cleans up the rows it creates so re-runs stay deterministic and
 * the seed set is left untouched.
 */

const created: string[] = [];

async function track<T extends { id: string }>(row: T): Promise<T> {
  created.push(row.id);
  return row;
}

afterEach(async () => {
  if (created.length === 0) return;
  // Delete children before parents to satisfy the SubCategories relation.
  const rows = await prisma.category.findMany({
    where: { id: { in: created } },
    select: { id: true, parentId: true },
  });
  const children = rows.filter((r) => r.parentId).map((r) => r.id);
  const parents = rows.filter((r) => !r.parentId).map((r) => r.id);
  if (children.length > 0) {
    await prisma.category.deleteMany({ where: { id: { in: children } } });
  }
  if (parents.length > 0) {
    await prisma.category.deleteMany({ where: { id: { in: parents } } });
  }
  created.length = 0;
});

describe("generateCategorySlug", () => {
  it("slugifies a name to lowercase ascii with hyphens", async () => {
    const slug = await generateCategorySlug("Fast Chargers & Cables");
    expect(slug).toBe("fast-chargers-and-cables");
  });

  it("suffixes to avoid collisions with an existing slug", async () => {
    const base = `Zzz Test Cat ${Date.now()}`;
    const first = await track(
      await createCategory({
        name: base,
        sortOrder: 0,
        status: "ACTIVE",
        parentId: null,
      }),
    );
    // A fresh slug for the same name must not equal the taken one.
    const next = await generateCategorySlug(base);
    expect(next).not.toBe(first.slug);
    expect(next.startsWith(first.slug)).toBe(true);
  });

  it("ignores a category's own slug via exceptId (no-op rename)", async () => {
    const cat = await track(
      await createCategory({
        name: `Keep Slug ${Date.now()}`,
        sortOrder: 0,
        status: "ACTIVE",
        parentId: null,
      }),
    );
    const same = await generateCategorySlug(cat.name, cat.id);
    expect(same).toBe(cat.slug);
  });
});

describe("createCategory", () => {
  it("auto-appends new top-level categories after existing siblings", async () => {
    // Deterministic regardless of ambient DB state: create one sibling, then a
    // second with the default sortOrder — the service must append it strictly
    // after the first.
    const first = await track(
      await createCategory({
        name: `Appended A ${Date.now()}`,
        sortOrder: 0,
        status: "ACTIVE",
        parentId: null,
      }),
    );
    const second = await track(
      await createCategory({
        name: `Appended B ${Date.now()}`,
        sortOrder: 0, // caller left it default -> service should append
        status: "ACTIVE",
        parentId: null,
      }),
    );
    expect(second.sortOrder).toBeGreaterThan(first.sortOrder);
  });

  it("honors an explicit non-zero sortOrder", async () => {
    const cat = await track(
      await createCategory({
        name: `Explicit Order ${Date.now()}`,
        sortOrder: 42,
        status: "ACTIVE",
        parentId: null,
      }),
    );
    expect(cat.sortOrder).toBe(42);
  });
});

describe("createSubCategory", () => {
  it("nests a child under a top-level parent", async () => {
    const parent = await track(
      await createCategory({
        name: `Parent ${Date.now()}`,
        sortOrder: 0,
        status: "ACTIVE",
        parentId: null,
      }),
    );
    const child = await track(
      await createSubCategory(parent.id, {
        name: `Child ${Date.now()}`,
        sortOrder: 0,
        status: "ACTIVE",
      }),
    );
    expect(child.parentId).toBe(parent.id);
  });

  it("rejects nesting more than two levels deep", async () => {
    const parent = await track(
      await createCategory({
        name: `L1 ${Date.now()}`,
        sortOrder: 0,
        status: "ACTIVE",
        parentId: null,
      }),
    );
    const child = await track(
      await createSubCategory(parent.id, {
        name: `L2 ${Date.now()}`,
        sortOrder: 0,
        status: "ACTIVE",
      }),
    );
    await expect(
      createSubCategory(child.id, {
        name: `L3 ${Date.now()}`,
        sortOrder: 0,
        status: "ACTIVE",
      }),
    ).rejects.toThrow(/nested more than one level/i);
  });
});

describe("reorderCategories", () => {
  it("assigns 0..n-1 sortOrder in the given order", async () => {
    const stamp = Date.now();
    const a = await track(
      await createCategory({ name: `Ra ${stamp}`, sortOrder: 0, status: "ACTIVE", parentId: null }),
    );
    const b = await track(
      await createCategory({ name: `Rb ${stamp}`, sortOrder: 0, status: "ACTIVE", parentId: null }),
    );
    const c = await track(
      await createCategory({ name: `Rc ${stamp}`, sortOrder: 0, status: "ACTIVE", parentId: null }),
    );

    await reorderCategories([c.id, a.id, b.id]);

    const rows = await prisma.category.findMany({
      where: { id: { in: [a.id, b.id, c.id] } },
      select: { id: true, sortOrder: true },
    });
    const order = new Map(rows.map((r) => [r.id, r.sortOrder]));
    expect(order.get(c.id)).toBe(0);
    expect(order.get(a.id)).toBe(1);
    expect(order.get(b.id)).toBe(2);
  });

  it("ignores unknown ids and preserves order of the known ones", async () => {
    const stamp = Date.now();
    const a = await track(
      await createCategory({ name: `Ia ${stamp}`, sortOrder: 0, status: "ACTIVE", parentId: null }),
    );
    const b = await track(
      await createCategory({ name: `Ib ${stamp}`, sortOrder: 0, status: "ACTIVE", parentId: null }),
    );
    const bogus = "0123456789abcdef01234567";

    await reorderCategories([b.id, bogus, a.id]);

    const rows = await prisma.category.findMany({
      where: { id: { in: [a.id, b.id] } },
      select: { id: true, sortOrder: true },
    });
    const order = new Map(rows.map((r) => [r.id, r.sortOrder]));
    // Known ids are compacted to 0,1 in requested order (bogus skipped).
    expect(order.get(b.id)).toBe(0);
    expect(order.get(a.id)).toBe(1);
  });

  it("is a no-op for an empty list", async () => {
    await expect(reorderCategories([])).resolves.toBeUndefined();
  });
});

describe("updateCategory", () => {
  it("regenerates a unique slug on rename", async () => {
    const cat = await track(
      await createCategory({
        name: `Rename Me ${Date.now()}`,
        sortOrder: 0,
        status: "ACTIVE",
        parentId: null,
      }),
    );
    const target = `Renamed Fresh Name ${Date.now()}`;
    const { slugify } = await import("@/lib/slug");
    const updated = await updateCategory(cat.id, { name: target });
    expect(updated.name).toBe(target);
    // A fresh unique name slugifies cleanly with no collision suffix.
    expect(updated.slug).toBe(slugify(target));
  });

  it("leaves the slug unchanged on a no-op rename", async () => {
    const cat = await track(
      await createCategory({
        name: `Stable Name ${Date.now()}`,
        sortOrder: 0,
        status: "ACTIVE",
        parentId: null,
      }),
    );
    const updated = await updateCategory(cat.id, { name: cat.name });
    expect(updated.slug).toBe(cat.slug);
  });
});

describe("setCategoryStatus", () => {
  it("toggles ACTIVE <-> INACTIVE", async () => {
    const cat = await track(
      await createCategory({
        name: `Toggle ${Date.now()}`,
        sortOrder: 0,
        status: "ACTIVE",
        parentId: null,
      }),
    );
    const off = await setCategoryStatus(cat.id, "INACTIVE");
    expect(off.status).toBe("INACTIVE");
    const on = await setCategoryStatus(cat.id, "ACTIVE");
    expect(on.status).toBe("ACTIVE");
  });
});
