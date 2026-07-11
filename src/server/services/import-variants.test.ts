/**
 * Tests for VARIANT-row bulk import (PRD Phase 11 fast-follow F2).
 *
 * Two layers:
 *
 *  1. PURE grouping + validation (no DB) — exercised through the public
 *     `validateRows(rows, mapping, existing, categories, headers)` entry point,
 *     which routes `variantOf` rows into the variant engine. Torture cases:
 *       - a 2-axis product (2×2 = 4 variants) groups + infers axes correctly,
 *       - duplicate variant SKU across the file is flagged on every occurrence,
 *       - mixing variant rows and plain single-product rows works (each path is
 *         independent and never double-counts),
 *       - duplicate option combo within a parent is rejected,
 *       - a missing option value / missing variant price is flagged,
 *       - NO `variantOf` column ⇒ behaves exactly like a single-product import.
 *
 *  2. DB commit (against the seeded local MongoDB, self-cleaning) — a 2×2 group
 *     commits to ONE variant product with four `ProductVariant` rows, the parent
 *     gets `hasVariants=true`, the inferred `optionTypes`, and a recomputed FROM
 *     price = min variant price.
 */

import { afterEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { prisma } from "@/server/db";
import {
  parseWorkbook,
  autoMapColumns,
  validateRows,
  commitImport,
  buildTemplateWorkbook,
  type CategoryRef,
  type ColumnMapping,
} from "./import";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const CATEGORIES: CategoryRef[] = [
  { id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Power Bank" },
  { id: "bbbbbbbbbbbbbbbbbbbbbbbb", name: "RAM" },
];

/** Variant sheet header including two option columns (Capacity, Color). */
const V_HEADER = [
  "Name",
  "SKU",
  "Brand",
  "Category",
  "Price (₹)",
  "MRP (₹)",
  "Stock status",
  "Status",
  "Variant Of (parent SKU)",
  "Capacity",
  "Color",
];

/** Build a rows[] + headers[] + mapping for a variant sheet from data rows. */
function sheet(header: string[], dataRows: string[][]) {
  const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "S");
  const buf = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
  const parsed = parseWorkbook(buf);
  const mapping: ColumnMapping = autoMapColumns(parsed.headers);
  return { rows: parsed.rows, headers: parsed.headers, mapping };
}

/* ------------------------------------------------------------------ */
/* PURE grouping + validation                                         */
/* ------------------------------------------------------------------ */

describe("validateRows — variant grouping (pure)", () => {
  it("groups a 2×2 (Capacity × Color) product into one group with 4 variants", () => {
    const { rows, headers, mapping } = sheet(V_HEADER, [
      ["Anker PowerBank Pro", "PBP-10K-BLK", "Anker", "Power Bank", "2499", "2999", "IN_STOCK", "ACTIVE", "PB-PRO", "10000mAh", "Black"],
      ["", "PBP-10K-WHT", "", "", "2499", "2999", "IN_STOCK", "ACTIVE", "PB-PRO", "10000mAh", "White"],
      ["", "PBP-20K-BLK", "", "", "3499", "3999", "LOW", "ACTIVE", "PB-PRO", "20000mAh", "Black"],
      ["", "PBP-20K-WHT", "", "", "3499", "3999", "OUT_OF_STOCK", "ACTIVE", "PB-PRO", "20000mAh", "White"],
    ]);

    const res = validateRows(rows, mapping, [], CATEGORIES, headers);

    expect(res.summary.variantProducts).toBe(1);
    expect(res.summary.variantRows).toBe(4);
    // No single-product creates/updates and no invalid rows.
    expect(res.summary.creates).toBe(0);
    expect(res.summary.updates).toBe(0);
    expect(res.summary.invalid).toBe(0);

    const group = res.variantGroups[0]!;
    expect(group.parentSku).toBe("PB-PRO");
    expect(group.valid).toBe(true);
    expect(group.variants).toHaveLength(4);
    // Product-level fields resolved from the first row.
    expect(group.product.name).toBe("Anker PowerBank Pro");
    expect(group.product.categoryName).toBe("Power Bank");
    expect(group.product.brand).toBe("Anker");

    // Two axes inferred, first-seen value order.
    expect(group.optionTypes).toEqual([
      { name: "Capacity", values: ["10000mAh", "20000mAh"] },
      { name: "Color", values: ["Black", "White"] },
    ]);

    // Each variant carries its own gated money (paise) + options.
    const black10k = group.variants.find((v) => v.sku === "PBP-10K-BLK")!;
    expect(black10k.price).toBe(249900);
    expect(black10k.mrp).toBe(299900);
    expect(black10k.optionValues).toEqual({
      Capacity: "10000mAh",
      Color: "Black",
    });

    // Every preview row for this group is marked as a variant row.
    const variantPreviewRows = res.rows.filter((r) => r.variant);
    expect(variantPreviewRows).toHaveLength(4);
    expect(variantPreviewRows.every((r) => r.operation === "variant")).toBe(true);
    expect(variantPreviewRows[0]!.variant!.isGroupLead).toBe(true);
    expect(variantPreviewRows[1]!.variant!.isGroupLead).toBe(false);
  });

  it("flags a duplicate variant SKU within the file on every occurrence", () => {
    const { rows, headers, mapping } = sheet(V_HEADER, [
      ["Kit", "DUP-SKU", "Acme", "RAM", "1000", "", "IN_STOCK", "ACTIVE", "KIT-1", "8GB", "Green"],
      ["", "dup-sku", "", "", "1200", "", "IN_STOCK", "ACTIVE", "KIT-1", "16GB", "Green"],
    ]);

    const res = validateRows(rows, mapping, [], CATEGORIES, headers);
    const group = res.variantGroups[0]!;
    expect(group.valid).toBe(false);
    // Both rows carry a duplicate-SKU error.
    expect(group.errorsByRow[2]?.some((e) => /duplicate/i.test(e.message))).toBe(true);
    expect(group.errorsByRow[3]?.some((e) => /duplicate/i.test(e.message))).toBe(true);
    // Both variant preview rows are invalid.
    expect(res.rows.filter((r) => r.operation === "invalid")).toHaveLength(2);
  });

  it("rejects a duplicate option combination within a parent", () => {
    const { rows, headers, mapping } = sheet(V_HEADER, [
      ["Kit", "K-A", "Acme", "RAM", "1000", "", "IN_STOCK", "ACTIVE", "KIT-2", "8GB", "Green"],
      ["", "K-B", "", "", "1200", "", "IN_STOCK", "ACTIVE", "KIT-2", "8GB", "green"],
    ]);

    const res = validateRows(rows, mapping, [], CATEGORIES, headers);
    const group = res.variantGroups[0]!;
    expect(group.valid).toBe(false);
    // The SECOND occurrence of the same combo (case-insensitive) is flagged.
    expect(
      group.errorsByRow[3]?.some((e) => /duplicate option combination/i.test(e.message)),
    ).toBe(true);
  });

  it("flags a missing option value and a missing variant price", () => {
    const { rows, headers, mapping } = sheet(V_HEADER, [
      ["Kit", "K-C", "Acme", "RAM", "", "", "IN_STOCK", "ACTIVE", "KIT-3", "8GB", ""],
    ]);
    const res = validateRows(rows, mapping, [], CATEGORIES, headers);
    const group = res.variantGroups[0]!;
    expect(group.valid).toBe(false);
    const errs = group.errorsByRow[2] ?? [];
    expect(errs.some((e) => /price is required/i.test(e.message))).toBe(true);
    expect(errs.some((e) => /Missing value for option "Color"/i.test(e.message))).toBe(true);
  });

  it("mixes variant rows and plain single-product rows independently", () => {
    // Row A: variant of KIT-4. Row B: variant of KIT-4. Row C: plain product.
    const { rows, headers, mapping } = sheet(V_HEADER, [
      ["Combo Kit", "CK-8", "Acme", "RAM", "1000", "", "IN_STOCK", "ACTIVE", "KIT-4", "8GB", "Blue"],
      ["", "CK-16", "", "", "1500", "", "IN_STOCK", "ACTIVE", "KIT-4", "16GB", "Blue"],
      ["Plain Stick", "PLAIN-1", "Acme", "RAM", "999", "", "IN_STOCK", "ACTIVE", "", "", ""],
    ]);

    const res = validateRows(rows, mapping, [], CATEGORIES, headers);

    // One variant product (2 rows) + one single-product create.
    expect(res.summary.variantProducts).toBe(1);
    expect(res.summary.variantRows).toBe(2);
    expect(res.summary.creates).toBe(1);
    expect(res.summary.invalid).toBe(0);

    // The plain row classifies as a normal create, not a variant.
    const plain = res.rows.find((r) => r.raw.sku === "PLAIN-1")!;
    expect(plain.operation).toBe("create");
    expect(plain.variant).toBeUndefined();

    const group = res.variantGroups[0]!;
    expect(group.variants).toHaveLength(2);
    expect(group.optionTypes).toEqual([
      { name: "Capacity", values: ["8GB", "16GB"] },
      { name: "Color", values: ["Blue"] },
    ]);
  });

  it("is a complete no-op when no variantOf column is present (single-product parity)", () => {
    const header = ["Name", "SKU", "Category", "Price (₹)"];
    const { rows, headers, mapping } = sheet(header, [
      ["Plain", "P1", "RAM", "500"],
    ]);
    // Pass headers (variant path is gated on variantOf being mapped, not on headers).
    const res = validateRows(rows, mapping, [], CATEGORIES, headers);
    expect(res.summary.variantProducts).toBe(0);
    expect(res.summary.variantRows).toBe(0);
    expect(res.summary.creates).toBe(1);
    expect(res.rows[0]!.operation).toBe("create");
    expect(res.rows[0]!.variant).toBeUndefined();
  });

  it("flags an unknown category on the parent group", () => {
    const { rows, headers, mapping } = sheet(V_HEADER, [
      ["Nope", "N-A", "Acme", "Graphene", "1000", "", "IN_STOCK", "ACTIVE", "KIT-X", "8GB", "Red"],
    ]);
    const res = validateRows(rows, mapping, [], CATEGORIES, headers);
    const group = res.variantGroups[0]!;
    expect(group.valid).toBe(false);
    expect(
      group.errorsByRow[2]?.some((e) => /Graphene/.test(e.message)),
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* template documents the variant format                              */
/* ------------------------------------------------------------------ */

describe("buildTemplateWorkbook — variant docs", () => {
  it("includes a 'Variants example' sheet demonstrating the format", () => {
    const bytes = buildTemplateWorkbook();
    const wb = XLSX.read(bytes, { type: "array" });
    expect(wb.SheetNames).toContain("Variants example");
    // The main sheet still round-trips as a clean single-product create.
    const parsed = parseWorkbook(bytes);
    const res = validateRows(parsed.rows, autoMapColumns(parsed.headers), [], CATEGORIES, parsed.headers);
    expect(res.rows[0]!.operation).toBe("create");
    expect(res.summary.variantProducts).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* DB commit (seeded MongoDB, self-cleaning)                          */
/* ------------------------------------------------------------------ */

describe("commitImport — variant groups (DB)", () => {
  const createdProductIds = new Set<string>();

  afterEach(async () => {
    for (const id of createdProductIds) {
      await prisma.productVariant.deleteMany({ where: { productId: id } });
      await prisma.product.delete({ where: { id } }).catch(() => undefined);
    }
    createdProductIds.clear();
  });

  async function seedCategory(): Promise<{ id: string; name: string }> {
    const cat = await prisma.category.findFirst({ select: { id: true, name: true } });
    if (!cat) throw new Error("seed missing: no category");
    return cat;
  }

  it("commits a 2×2 group to one variant product with four variants + FROM price", async () => {
    const cat = await seedCategory();
    const parentSku = `IMP-PBP-${Date.now().toString(36)}`.toUpperCase();

    const { rows, headers, mapping } = sheet(V_HEADER, [
      ["Import Pack", `${parentSku}-A`, "ImpBrand", cat.name, "2499", "2999", "IN_STOCK", "ACTIVE", parentSku, "10000mAh", "Black"],
      ["", `${parentSku}-B`, "", "", "2499", "2999", "IN_STOCK", "ACTIVE", parentSku, "10000mAh", "White"],
      ["", `${parentSku}-C`, "", "", "3499", "3999", "LOW", "ACTIVE", parentSku, "20000mAh", "Black"],
      ["", `${parentSku}-D`, "", "", "3499", "3999", "OUT_OF_STOCK", "ACTIVE", parentSku, "20000mAh", "White"],
    ]);

    const validated = validateRows(rows, mapping, [], [{ id: cat.id, name: cat.name }], headers);
    expect(validated.variantGroups[0]!.valid).toBe(true);

    const result = await commitImport({
      rows: validated.rows,
      variantGroups: validated.variantGroups,
    });

    expect(result.variantProductsCreated).toBe(1);
    expect(result.variantsWritten).toBe(4);
    expect(result.skipped).toHaveLength(0);

    const parent = await prisma.product.findFirst({
      where: { sku: parentSku },
      select: { id: true, hasVariants: true, price: true, optionTypes: true },
    });
    expect(parent).not.toBeNull();
    createdProductIds.add(parent!.id);

    expect(parent!.hasVariants).toBe(true);
    // FROM price = min variant price (2499 → paise).
    expect(parent!.price).toBe(249900);

    const variants = await prisma.productVariant.findMany({
      where: { productId: parent!.id },
      select: { sku: true, price: true, optionValues: true },
    });
    expect(variants).toHaveLength(4);
    const skus = variants.map((v) => v.sku).sort();
    expect(skus).toEqual(
      [`${parentSku}-A`, `${parentSku}-B`, `${parentSku}-C`, `${parentSku}-D`].sort(),
    );
  });
});
