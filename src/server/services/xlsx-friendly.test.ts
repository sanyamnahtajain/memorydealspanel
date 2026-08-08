import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { beautifyXlsx } from "./xlsx-friendly";
import { buildTemplateWorkbook } from "./import";

/**
 * Friendly-XLSX pass (owner: "super easy bulk edit"). Round-trips real bytes
 * (the actual import template + a catalog-export-shaped sheet) and asserts the
 * editing affordances survive: frozen bold header, autofilter, widths, and
 * enum DROPDOWNS on Stock status / Status / Tax inclusive.
 */

async function load(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return wb;
}

function headerIndex(ws: ExcelJS.Worksheet, label: string): number {
  let found = 0;
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    if (String(cell.value ?? "").trim().toLowerCase() === label.toLowerCase()) found = col;
  });
  return found;
}

describe("beautifyXlsx", () => {
  it("upgrades the real import template: frozen header, filter, dropdowns", async () => {
    const out = await beautifyXlsx(buildTemplateWorkbook());
    const wb = await load(out);
    const ws = wb.worksheets[0];

    // Frozen + styled header.
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(ws.getRow(1).font?.bold).toBe(true);
    expect(ws.autoFilter).toBeTruthy();

    // Dropdown on the Stock status column, data row 2.
    const stockCol = headerIndex(ws, "Stock status");
    expect(stockCol).toBeGreaterThan(0);
    const dv = ws.getCell(2, stockCol).dataValidation;
    expect(dv?.type).toBe("list");
    expect(dv?.formulae?.[0]).toContain("IN_STOCK");

    // Status column too.
    const statusCol = headerIndex(ws, "Status");
    expect(ws.getCell(2, statusCol).dataValidation?.formulae?.[0]).toContain("ACTIVE");
  });

  it("upgrades an export-shaped sheet (snake_case headers) and widens Name", async () => {
    const aoa = [
      ["name", "sku", "stockStatus", "status", "tax_inclusive", "description"],
      ["POR 2730", "P1", "IN_STOCK", "ACTIVE", "true", "line1\nline2"],
    ];
    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Catalog");
    const bytes = new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer);

    const wb = await load(await beautifyXlsx(bytes));
    const ws = wb.worksheets[0];
    expect(ws.views[0]?.state).toBe("frozen");
    expect(ws.getCell(2, headerIndex(ws, "stockStatus")).dataValidation?.formulae?.[0]).toContain("OUT_OF_STOCK");
    expect(ws.getCell(2, headerIndex(ws, "tax_inclusive")).dataValidation?.formulae?.[0]).toContain("true");
    expect(ws.getColumn(headerIndex(ws, "name")).width).toBeGreaterThanOrEqual(40);
  });

  it("keeps the data intact (values survive the round trip)", async () => {
    const out = await beautifyXlsx(buildTemplateWorkbook());
    const parsed = XLSX.read(out, { type: "array" });
    const first = parsed.Sheets[parsed.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(first);
    expect(rows.length).toBeGreaterThan(0); // the template's example rows survive
  });
});
