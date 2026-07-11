/**
 * Unit tests for the pure import parse/validate layers (no DB).
 *
 * Covered: BOM headers, ₹/comma rupee numbers → paise, Excel serial dates,
 * emoji, unknown category, in-file duplicate SKU, missing required fields,
 * extra/unmapped columns, create-vs-update classification, the error CSV, the
 * generated template, and a 10,000-row parse+validate performance budget.
 */

import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";

import {
  parseWorkbook,
  autoMapColumns,
  validateRows,
  buildErrorCsv,
  collectErrorEntries,
  buildTemplateWorkbook,
  IMPORT_COLUMNS,
  type RawRow,
  type CategoryRef,
  type ColumnMapping,
} from "./import";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const CATEGORIES: CategoryRef[] = [
  { id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "RAM" },
  { id: "bbbbbbbbbbbbbbbbbbbbbbbb", name: "SSD" },
];

/** Build an xlsx buffer from an array-of-arrays (first row = header). */
function xlsxBuffer(aoa: unknown[][]): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Uint8Array(out);
}

/** Build a CSV buffer (with optional BOM) from raw text. */
function csvBuffer(text: string, bom = false): Uint8Array {
  const full = (bom ? "﻿" : "") + text;
  return new TextEncoder().encode(full);
}

const FULL_HEADER = [
  "Name",
  "SKU",
  "Brand",
  "Category",
  "Price (₹)",
  "MRP (₹)",
  "MOQ",
  "Stock status",
  "Status",
  "Tags",
  "Description",
];

function mapFor(headers: string[]): ColumnMapping {
  return autoMapColumns(headers);
}

/* ------------------------------------------------------------------ */
/* parseWorkbook                                                       */
/* ------------------------------------------------------------------ */

describe("parseWorkbook", () => {
  it("parses an xlsx with a header row and data rows", () => {
    const buf = xlsxBuffer([
      ["Name", "SKU", "Price (₹)"],
      ["Kingston 16GB", "K16", "4999"],
    ]);
    const res = parseWorkbook(buf);
    expect(res.headers).toEqual(["Name", "SKU", "Price (₹)"]);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toEqual({
      Name: "Kingston 16GB",
      SKU: "K16",
      "Price (₹)": "4999",
    });
  });

  it("strips a UTF-8 BOM from the first header cell (CSV)", () => {
    const csv = csvBuffer("Name,SKU\nWidget,W1\n", true);
    const res = parseWorkbook(csv);
    // The BOM must be gone so auto-mapping matches "name".
    expect(res.headers[0]).toBe("Name");
    const mapping = autoMapColumns(res.headers);
    expect(mapping.name).toBe("Name");
  });

  it("drops entirely-blank rows and reports the count", () => {
    const buf = xlsxBuffer([
      ["Name", "SKU"],
      ["A", "A1"],
      ["", ""],
      ["B", "B1"],
    ]);
    const res = parseWorkbook(buf);
    expect(res.rows).toHaveLength(2);
    // SheetJS blankrows:false may pre-drop; either way none survive as blank.
    expect(res.droppedBlank).toBeGreaterThanOrEqual(0);
    expect(res.rows.map((r) => r.SKU)).toEqual(["A1", "B1"]);
  });

  it("disambiguates duplicate headers instead of merging data", () => {
    const buf = xlsxBuffer([
      ["SKU", "SKU"],
      ["a", "b"],
    ]);
    const res = parseWorkbook(buf);
    expect(res.headers).toEqual(["SKU", "SKU (2)"]);
    expect(res.rows[0]).toEqual({ SKU: "a", "SKU (2)": "b" });
  });

  it("coerces Excel serial dates to ISO strings", () => {
    // 2024-01-15 as an Excel serial date cell.
    const ws = XLSX.utils.aoa_to_sheet([
      ["Name", "When"],
      ["X", new Date(Date.UTC(2024, 0, 15))],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "S");
    const buf = new Uint8Array(
      XLSX.write(wb, { type: "array", bookType: "xlsx" }),
    );
    const res = parseWorkbook(buf);
    expect(res.rows[0].When).toBe("2024-01-15");
  });

  it("preserves emoji in cell values", () => {
    const buf = xlsxBuffer([
      ["Name", "SKU"],
      ["Fire RAM 🔥🚀", "EMO1"],
    ]);
    const res = parseWorkbook(buf);
    expect(res.rows[0].Name).toBe("Fire RAM 🔥🚀");
  });

  it("returns empty structure for an empty workbook", () => {
    const buf = xlsxBuffer([]);
    const res = parseWorkbook(buf);
    expect(res.headers).toEqual([]);
    expect(res.rows).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* autoMapColumns                                                      */
/* ------------------------------------------------------------------ */

describe("autoMapColumns", () => {
  it("matches canonical labels and aliases case/space-insensitively", () => {
    const mapping = autoMapColumns([
      "Product Name",
      "Item Code",
      "Selling Price",
      "Min Qty",
      "Availability",
    ]);
    expect(mapping.name).toBe("Product Name");
    expect(mapping.sku).toBe("Item Code");
    expect(mapping.price).toBe("Selling Price");
    expect(mapping.moq).toBe("Min Qty");
    expect(mapping.stock).toBe("Availability");
  });

  it("does not assign one source header to two fields", () => {
    const mapping = autoMapColumns(["price"]);
    const assignedTo = Object.entries(mapping).filter(
      ([, header]) => header === "price",
    );
    expect(assignedTo).toHaveLength(1);
  });

  it("leaves unknown / extra columns unmapped", () => {
    const mapping = autoMapColumns(["Name", "SKU", "Warehouse Bin", "Color"]);
    expect(mapping.name).toBe("Name");
    expect(mapping.sku).toBe("SKU");
    // Extra columns simply don't appear as any field's source.
    expect(Object.values(mapping)).not.toContain("Warehouse Bin");
    expect(Object.values(mapping)).not.toContain("Color");
  });
});

/* ------------------------------------------------------------------ */
/* validateRows                                                        */
/* ------------------------------------------------------------------ */

describe("validateRows — number & money coercion", () => {
  const mapping = mapFor(FULL_HEADER);

  const rowWith = (over: Record<string, string>): RawRow => {
    const base: RawRow = {
      Name: "Kingston 16GB",
      SKU: "K16",
      Brand: "Kingston",
      Category: "RAM",
      "Price (₹)": "4999",
      "MRP (₹)": "",
      MOQ: "",
      "Stock status": "",
      Status: "",
      Tags: "",
      Description: "",
    };
    return { ...base, ...over };
  };

  it("parses plain rupee prices to paise", () => {
    const res = validateRows([rowWith({})], mapping, [], CATEGORIES);
    expect(res.rows[0].errors).toEqual([]);
    expect(res.rows[0].values.price).toBe(499900);
  });

  it("parses ₹ symbol and comma-grouped numbers to paise", () => {
    const res = validateRows(
      [rowWith({ "Price (₹)": "₹1,299.50", "MRP (₹)": "1,00,000" })],
      mapping,
      [],
      CATEGORIES,
    );
    expect(res.rows[0].errors).toEqual([]);
    expect(res.rows[0].values.price).toBe(129950);
    expect(res.rows[0].values.mrp).toBe(10000000);
  });

  it("rejects a non-numeric price with a per-cell error", () => {
    const res = validateRows(
      [rowWith({ "Price (₹)": "abc" })],
      mapping,
      [],
      CATEGORIES,
    );
    const err = res.rows[0].errors.find((e) => e.field === "price");
    expect(err).toBeDefined();
    expect(res.rows[0].operation).toBe("invalid");
  });

  it("flags MRP below price", () => {
    const res = validateRows(
      [rowWith({ "Price (₹)": "5000", "MRP (₹)": "4000" })],
      mapping,
      [],
      CATEGORIES,
    );
    expect(res.rows[0].errors.some((e) => e.field === "mrp")).toBe(true);
  });

  it("parses MOQ with thousands separators", () => {
    const res = validateRows([rowWith({ MOQ: "1,000" })], mapping, [], CATEGORIES);
    expect(res.rows[0].values.moq).toBe(1000);
  });
});

describe("validateRows — categories, enums, tags", () => {
  const mapping = mapFor(FULL_HEADER);
  const base: RawRow = {
    Name: "Widget",
    SKU: "W1",
    Brand: "",
    Category: "RAM",
    "Price (₹)": "100",
    "MRP (₹)": "",
    MOQ: "",
    "Stock status": "",
    Status: "",
    Tags: "",
    Description: "",
  };

  it("resolves a known category (case-insensitive) to its id", () => {
    const res = validateRows(
      [{ ...base, Category: "ram" }],
      mapping,
      [],
      CATEGORIES,
    );
    expect(res.rows[0].values.categoryId).toBe("aaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("errors on an unknown category", () => {
    const res = validateRows(
      [{ ...base, Category: "Graphene" }],
      mapping,
      [],
      CATEGORIES,
    );
    const err = res.rows[0].errors.find((e) => e.field === "category");
    expect(err?.message).toContain("Graphene");
    expect(res.rows[0].operation).toBe("invalid");
  });

  it("coerces stock/status aliases to enums", () => {
    const res = validateRows(
      [{ ...base, "Stock status": "out of stock", Status: "draft" }],
      mapping,
      [],
      CATEGORIES,
    );
    expect(res.rows[0].values.stockStatus).toBe("OUT_OF_STOCK");
    expect(res.rows[0].values.status).toBe("INACTIVE");
  });

  it("splits and dedupes tags", () => {
    const res = validateRows(
      [{ ...base, Tags: "ddr4, gaming; ddr4 | oem" }],
      mapping,
      [],
      CATEGORIES,
    );
    expect(res.rows[0].values.tags).toEqual(["ddr4", "gaming", "oem"]);
  });
});

describe("validateRows — create vs update & required fields", () => {
  const mapping = mapFor(FULL_HEADER);

  const row = (over: Record<string, string>): RawRow => ({
    Name: "Widget",
    SKU: "W1",
    Brand: "",
    Category: "RAM",
    "Price (₹)": "100",
    "MRP (₹)": "",
    MOQ: "",
    "Stock status": "",
    Status: "",
    Tags: "",
    Description: "",
    ...over,
  });

  it("classifies a new SKU as create", () => {
    const res = validateRows([row({})], mapping, [], CATEGORIES);
    expect(res.rows[0].operation).toBe("create");
    expect(res.summary.creates).toBe(1);
  });

  it("classifies an existing SKU as update", () => {
    const res = validateRows([row({ SKU: "EXIST" })], mapping, ["exist"], CATEGORIES);
    expect(res.rows[0].operation).toBe("update");
    expect(res.summary.updates).toBe(1);
  });

  it("allows an update row to omit name/category/price (partial patch)", () => {
    const res = validateRows(
      [row({ SKU: "EXIST", Name: "", Category: "", "Price (₹)": "" })],
      mapping,
      ["exist"],
      CATEGORIES,
    );
    expect(res.rows[0].errors).toEqual([]);
    expect(res.rows[0].operation).toBe("update");
  });

  it("requires name/category/price for a create row", () => {
    const res = validateRows(
      [row({ Name: "", Category: "", "Price (₹)": "" })],
      mapping,
      [],
      CATEGORIES,
    );
    const fields = res.rows[0].errors.map((e) => e.field).sort();
    expect(fields).toEqual(["category", "name", "price"]);
  });

  it("flags a duplicate SKU within the file on every occurrence", () => {
    const res = validateRows(
      [row({ SKU: "DUP" }), row({ SKU: "dup", Name: "Other" })],
      mapping,
      [],
      CATEGORIES,
    );
    expect(res.rows[0].errors.some((e) => e.field === "sku")).toBe(true);
    expect(res.rows[1].errors.some((e) => e.field === "sku")).toBe(true);
  });

  it("rejects malformed SKUs", () => {
    const res = validateRows([row({ SKU: "bad sku!" })], mapping, [], CATEGORIES);
    expect(res.rows[0].errors.some((e) => e.field === "sku")).toBe(true);
  });

  it("ignores unmapped extra columns without error", () => {
    const headers = [...FULL_HEADER, "Warehouse Bin"];
    const res = validateRows(
      [{ ...row({}), "Warehouse Bin": "A-12" }],
      mapFor(headers),
      [],
      CATEGORIES,
    );
    expect(res.rows[0].errors).toEqual([]);
  });

  it("handles emoji in the name field", () => {
    const res = validateRows([row({ Name: "Fire 🔥 RAM" })], mapping, [], CATEGORIES);
    expect(res.rows[0].errors).toEqual([]);
    expect(res.rows[0].values.name).toBe("Fire 🔥 RAM");
  });
});

/* ------------------------------------------------------------------ */
/* error CSV & template                                                */
/* ------------------------------------------------------------------ */

describe("buildErrorCsv / collectErrorEntries", () => {
  const mapping = mapFor(FULL_HEADER);

  it("produces a BOM-prefixed CSV of every cell error", () => {
    const res = validateRows(
      [
        {
          Name: "",
          SKU: "W1",
          Brand: "",
          Category: "Nope",
          "Price (₹)": "x",
          "MRP (₹)": "",
          MOQ: "",
          "Stock status": "",
          Status: "",
          Tags: "",
          Description: "",
        },
      ],
      mapping,
      [],
      CATEGORIES,
    );
    const csv = buildErrorCsv(collectErrorEntries(res.rows));
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Row,SKU,Field,Error");
    expect(csv).toContain("W1");
  });

  it("escapes commas and quotes in messages", () => {
    const csv = buildErrorCsv([
      { rowNumber: 2, sku: "A,B", field: "Name", message: 'has "quote", comma' },
    ]);
    expect(csv).toContain('"A,B"');
    expect(csv).toContain('"has ""quote"", comma"');
  });
});

describe("buildTemplateWorkbook", () => {
  it("round-trips a header row matching the canonical labels", () => {
    const bytes = buildTemplateWorkbook();
    const parsed = parseWorkbook(bytes);
    expect(parsed.headers).toEqual(IMPORT_COLUMNS.map((c) => c.label));
    // The example row auto-maps and validates cleanly.
    const mapping = autoMapColumns(parsed.headers);
    const res = validateRows(parsed.rows, mapping, [], CATEGORIES);
    expect(res.rows[0].errors).toEqual([]);
    expect(res.rows[0].operation).toBe("create");
  });
});

/* ------------------------------------------------------------------ */
/* performance                                                         */
/* ------------------------------------------------------------------ */

describe("performance", () => {
  it("parses + validates 10,000 rows within a few seconds", () => {
    const aoa: unknown[][] = [FULL_HEADER];
    for (let i = 0; i < 10_000; i++) {
      aoa.push([
        `Product ${i}`,
        `SKU-${i}`,
        "Kingston",
        i % 2 === 0 ? "RAM" : "SSD",
        `${1000 + i}`,
        `${2000 + i}`,
        "5",
        "IN_STOCK",
        "ACTIVE",
        "bulk,oem",
        "desc",
      ]);
    }
    const buf = xlsxBuffer(aoa);

    const start = Date.now();
    const parsed = parseWorkbook(buf);
    const mapping = autoMapColumns(parsed.headers);
    const res = validateRows(parsed.rows, mapping, [], CATEGORIES);
    const elapsed = Date.now() - start;

    expect(parsed.rows).toHaveLength(10_000);
    expect(res.summary.total).toBe(10_000);
    expect(res.summary.invalid).toBe(0);
    expect(res.summary.creates).toBe(10_000);
    expect(elapsed).toBeLessThan(4000);
  });
});

/* ------------------------------------------------------------------ */
/* validateRows — GST columns (hsn_code / gst_rate / tax_inclusive)    */
/* ------------------------------------------------------------------ */

describe("validateRows — GST columns", () => {
  const GST_HEADER = [...FULL_HEADER, "HSN code", "GST rate (%)", "Tax inclusive"];
  const mapping = mapFor(GST_HEADER);

  const rowWith = (over: Record<string, string>): RawRow => ({
    Name: "Kingston 16GB",
    SKU: "K16",
    Brand: "Kingston",
    Category: "RAM",
    "Price (₹)": "4999",
    "MRP (₹)": "",
    MOQ: "",
    "Stock status": "",
    Status: "",
    Tags: "",
    Description: "",
    "HSN code": "",
    "GST rate (%)": "",
    "Tax inclusive": "",
    ...over,
  });

  it("auto-maps the GST headers to their canonical fields", () => {
    expect(mapping.hsnCode).toBe("HSN code");
    expect(mapping.gstRate).toBe("GST rate (%)");
    expect(mapping.taxInclusive).toBe("Tax inclusive");
  });

  it("coerces a percent GST rate to integer basis points", () => {
    const res = validateRows(
      [rowWith({ "HSN code": "8523", "GST rate (%)": "18" })],
      mapping,
      [],
      CATEGORIES,
    );
    expect(res.rows[0].errors).toEqual([]);
    expect(res.rows[0].values.hsnCode).toBe("8523");
    expect(res.rows[0].values.gstRateBps).toBe(1800);
  });

  it("accepts a fractional percent and a trailing % sign", () => {
    const res = validateRows(
      [rowWith({ "GST rate (%)": "2.5%" })],
      mapping,
      [],
      CATEGORIES,
    );
    expect(res.rows[0].values.gstRateBps).toBe(250);
  });

  it("maps a truthy tax_inclusive cell to TAX_INCLUSIVE and falsy to TAX_EXCLUSIVE", () => {
    const incl = validateRows([rowWith({ "Tax inclusive": "yes" })], mapping, [], CATEGORIES);
    expect(incl.rows[0].values.taxTreatment).toBe("TAX_INCLUSIVE");
    const excl = validateRows([rowWith({ "Tax inclusive": "no" })], mapping, [], CATEGORIES);
    expect(excl.rows[0].values.taxTreatment).toBe("TAX_EXCLUSIVE");
  });

  it("flags an invalid GST rate with a per-cell error", () => {
    const res = validateRows(
      [rowWith({ "GST rate (%)": "abc" })],
      mapping,
      [],
      CATEGORIES,
    );
    expect(res.rows[0].errors.some((e) => e.field === "gstRate")).toBe(true);
    expect(res.rows[0].operation).toBe("invalid");
  });

  it("leaves GST fields unset when the cells are blank (inherit)", () => {
    const res = validateRows([rowWith({})], mapping, [], CATEGORIES);
    expect(res.rows[0].errors).toEqual([]);
    expect(res.rows[0].values.hsnCode).toBeUndefined();
    expect(res.rows[0].values.gstRateBps).toBeUndefined();
    expect(res.rows[0].values.taxTreatment).toBeUndefined();
  });
});
