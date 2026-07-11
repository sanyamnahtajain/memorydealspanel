/**
 * Bulk import engine (PRD F-A19) — CSV / XLSX ingest with a foolproof preview.
 *
 * This module is deliberately split into three PURE, DB-free layers that are
 * unit-tested in isolation (see import.test.ts):
 *
 *   1. parseWorkbook(buffer)            → raw rows keyed by their header cell
 *   2. validateRows(rows, mapping, …)   → per-row + per-cell errors + coercion
 *   3. buildErrorCsv(...)               → a downloadable "fix me" report
 *
 * Only `commitImport(...)` touches the database, and it does so exclusively
 * through the audited product SERVICE layer (createProduct / updateProduct) so
 * every invariant (unique slug, unique SKU, category existence, mrp ≥ price)
 * is enforced exactly once, in one place.
 *
 * Money is integer paise everywhere. Rupee input ("₹1,299.50", "1,00,000") is
 * parsed via lib/money.parseRupees; Excel numeric cells are coerced safely.
 */

import * as XLSX from "xlsx";

import { parseRupees } from "@/lib/money";
import { slugify } from "@/lib/slug";
import {
  entityStatusSchema,
  stockStatusSchema,
  type EntityStatus,
  type StockStatus,
} from "@/lib/schemas/shared";
import {
  createProduct,
  updateProduct,
  isProductServiceError,
} from "@/server/services/products";
import type { CreateProductInput, UpdateProductInput } from "@/lib/schemas/product";
import type { OptionTypesInput, OptionValues } from "@/lib/schemas/variant";
import {
  groupVariantRows,
  type CoercedVariant,
  type VariantColumnContext,
  type VariantGroup,
} from "@/server/services/import-variants";

/* ------------------------------------------------------------------ */
/* Column schema — the stable, canonical set of import fields          */
/* ------------------------------------------------------------------ */

/** Canonical import field keys (the target of every column mapping). */
export type ImportField =
  | "name"
  | "sku"
  | "brand"
  | "category"
  | "price"
  | "mrp"
  | "moq"
  | "stock"
  | "status"
  | "tags"
  | "description"
  | "variantOf";

export interface ImportColumn {
  /** Canonical field key. */
  key: ImportField;
  /** Human label shown in the mapper and template header. */
  label: string;
  /** Whether a value is required for a *create* (updates need only sku). */
  required: boolean;
  /** How the cell is coerced/validated. */
  kind: "text" | "currency" | "int" | "enum-stock" | "enum-status" | "tags";
  /** Header aliases used for auto-matching (case/space/punct-insensitive). */
  aliases: string[];
}

/**
 * The single source of truth for import columns. Order here is the order used
 * by the downloadable template and the default preview layout.
 */
export const IMPORT_COLUMNS: readonly ImportColumn[] = [
  {
    key: "name",
    label: "Name",
    required: true,
    kind: "text",
    aliases: ["name", "productname", "title", "product"],
  },
  {
    key: "sku",
    label: "SKU",
    required: true,
    kind: "text",
    aliases: ["sku", "code", "productcode", "itemcode", "partno", "partnumber"],
  },
  {
    key: "brand",
    label: "Brand",
    required: false,
    kind: "text",
    aliases: ["brand", "make", "manufacturer"],
  },
  {
    key: "category",
    label: "Category",
    required: true,
    kind: "text",
    aliases: ["category", "cat", "categoryname", "group"],
  },
  {
    key: "price",
    label: "Price (₹)",
    required: true,
    kind: "currency",
    aliases: ["price", "sellingprice", "rate", "sp", "ourprice", "dealprice"],
  },
  {
    key: "mrp",
    label: "MRP (₹)",
    required: false,
    kind: "currency",
    aliases: ["mrp", "listprice", "maxprice", "retailprice"],
  },
  {
    key: "moq",
    label: "MOQ",
    required: false,
    kind: "int",
    aliases: ["moq", "minqty", "minorder", "minimumorderquantity"],
  },
  {
    key: "stock",
    label: "Stock status",
    required: false,
    kind: "enum-stock",
    aliases: ["stock", "stockstatus", "availability", "instock"],
  },
  {
    key: "status",
    label: "Status",
    required: false,
    kind: "enum-status",
    aliases: ["status", "active", "state", "published"],
  },
  {
    key: "tags",
    label: "Tags",
    required: false,
    kind: "tags",
    aliases: ["tags", "labels", "keywords"],
  },
  {
    key: "description",
    label: "Description",
    required: false,
    kind: "text",
    aliases: ["description", "desc", "details", "notes"],
  },
  {
    // OPTIONAL variant column. When a row carries a value here — the PARENT
    // product's SKU — the row is treated as a VARIANT row (see import-variants).
    // Rows sharing this value form one variant product; the option axes come
    // from any extra (unmapped) columns like "Capacity"/"Color". A blank cell
    // means the row is an ordinary single product and is imported as before.
    key: "variantOf",
    label: "Variant Of (parent SKU)",
    required: false,
    kind: "text",
    aliases: [
      "variantof",
      "variantofparentsku",
      "parent",
      "parentsku",
      "parentcode",
      "belongsto",
      "variantparent",
    ],
  },
] as const;

const COLUMN_BY_KEY: Record<ImportField, ImportColumn> = Object.fromEntries(
  IMPORT_COLUMNS.map((c) => [c.key, c]),
) as Record<ImportField, ImportColumn>;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** A single raw row: the sheet's header cell → its (string) value. */
export type RawRow = Record<string, string>;

export interface ParseResult {
  /** Original header cells in sheet order (deduped, BOM-trimmed). */
  headers: string[];
  /** Data rows, each keyed by header. Empty rows are dropped. */
  rows: RawRow[];
  /** Number of rows dropped because they were entirely blank. */
  droppedBlank: number;
}

/** Maps a canonical field to the source header it should read from. */
export type ColumnMapping = Partial<Record<ImportField, string>>;

export interface CategoryRef {
  id: string;
  name: string;
}

/** A per-cell validation error within a preview row. */
export interface CellError {
  field: ImportField;
  message: string;
}

/**
 * Whether a valid row would create a new product, update an existing one, or is
 * a VARIANT row that will be committed as part of its parent group.
 */
export type RowOperation = "create" | "update" | "invalid" | "variant";

/**
 * A single validated preview row. `values` holds *coerced, ready-to-commit*
 * field values (paise for money, resolved categoryId, normalized enums). The
 * grid renders `raw` for display and `errors` for per-cell highlighting.
 */
export interface PreviewRow {
  /** Stable synthetic id (1-based source row index, prefixed). */
  id: string;
  /** 1-based row number in the source sheet (for the error report). */
  rowNumber: number;
  /** The raw string values as read from the sheet (mapped to fields). */
  raw: Record<ImportField, string>;
  /** Coerced values, valid only when `errors` is empty. */
  values: CoercedRow;
  /** Per-cell errors (empty ⇒ row is committable). */
  errors: CellError[];
  /** create / update / invalid / variant. */
  operation: RowOperation;
  /**
   * Present ONLY on variant rows (rows carrying a `variantOf` value). Carries
   * the display context the preview grid uses to visualise variant grouping,
   * plus the parent SKU that ties the row to its {@link VariantGroupSummary}.
   */
  variant?: PreviewVariantMeta;
}

/** Per-row variant display metadata (parent SKU + chosen option values). */
export interface PreviewVariantMeta {
  /** The parent product SKU this variant row belongs to (`variantOf` value). */
  parentSku: string;
  /** The chosen option values for this row, e.g. `{ Capacity: "16GB" }`. */
  optionValues: OptionValues;
  /** True when this is the FIRST row of its parent group (carries product fields). */
  isGroupLead: boolean;
}

/**
 * A validated variant GROUP, projected for the preview + commit layers. One per
 * distinct `variantOf` parent SKU. `valid` is true only when every row in the
 * group is error-free, so the whole product commits atomically or not at all.
 */
export interface VariantGroupSummary {
  parentSku: string;
  product: VariantGroup["product"];
  optionTypes: OptionTypesInput;
  variants: CoercedVariant[];
  rowNumbers: number[];
  variantCount: number;
  valid: boolean;
  /**
   * Per-row errors for this group, keyed by 1-based source row number. A plain
   * record (not a Map) so it serializes across the server-action boundary. Each
   * entry lists the offending source header + message; the matching preview row
   * also carries these (re-keyed to canonical fields) for cell highlighting.
   */
  errorsByRow: Record<number, Array<{ header: string; message: string }>>;
}

/** Coerced, commit-ready shape (paise money, resolved category, enums). */
export interface CoercedRow {
  name?: string;
  sku?: string;
  brand?: string;
  categoryId?: string;
  categoryName?: string;
  price?: number; // paise
  mrp?: number; // paise
  moq?: number;
  stockStatus?: StockStatus;
  status?: EntityStatus;
  tags?: string[];
  description?: string;
}

export interface ValidateResult {
  rows: PreviewRow[];
  summary: {
    total: number;
    creates: number;
    updates: number;
    invalid: number;
    /** Number of variant PRODUCTS (parent groups) detected. */
    variantProducts: number;
    /** Number of variant ROWS across all groups. */
    variantRows: number;
  };
  /**
   * Validated variant groups (one per parent SKU). Empty when the sheet has no
   * `variantOf` column mapped — i.e. a plain single-product import.
   */
  variantGroups: VariantGroupSummary[];
}

export interface SkippedRow {
  rowNumber: number;
  sku: string;
  reason: string;
}

export interface CommitResult {
  created: number;
  updated: number;
  skipped: SkippedRow[];
  /** Variant PRODUCTS created (a `variantOf` group whose parent was new). */
  variantProductsCreated: number;
  /** Variant PRODUCTS updated (parent already existed). */
  variantProductsUpdated: number;
  /** Total variant ROWS written across all committed groups. */
  variantsWritten: number;
  /** CSV text of every skipped/failed row with its reason (may be empty). */
  errorsCsv: string;
  /**
   * Brands AUTO-CREATED during this import (a brand column value that matched
   * no existing brand). Surfaced so the summary can tell the admin which new
   * masters were minted. Empty when every brand already existed.
   */
  newBrands: string[];
}

/* ------------------------------------------------------------------ */
/* 1. parseWorkbook                                                    */
/* ------------------------------------------------------------------ */

const BOM = /^﻿/;

/** Strips a leading UTF-8 BOM and trims a header cell. */
function cleanHeader(value: unknown): string {
  return String(value ?? "").replace(BOM, "").trim();
}

/**
 * Coerces any sheet cell to a safe string:
 *  - Excel *date* cells (SheetJS `Date` objects) → ISO date (YYYY-MM-DD).
 *  - numbers → their plain decimal string (no scientific notation for ints).
 *  - everything else → trimmed string, with a leading BOM stripped.
 *
 * We read the workbook with `cellDates: true`, so serial dates already arrive
 * as `Date`; the fallback below also handles a raw Excel serial number should
 * a caller pass `cellDates:false`.
 */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // Normalize to an ISO calendar date; guard against Invalid Date.
    const time = value.getTime();
    if (Number.isNaN(time)) return "";
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value).replace(BOM, "").trim();
}

/**
 * Parses an XLSX or CSV buffer into headers + row objects. The first sheet's
 * first row is treated as the header. Duplicate headers are disambiguated with
 * a numeric suffix so no data is silently merged. Fully-blank rows are dropped.
 */
export function parseWorkbook(buffer: ArrayBuffer | Uint8Array | Buffer): ParseResult {
  const data =
    buffer instanceof Uint8Array || Buffer.isBuffer(buffer)
      ? buffer
      : new Uint8Array(buffer);

  const wb = XLSX.read(data, {
    type: "array",
    cellDates: true,
    raw: false,
  });

  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { headers: [], rows: [], droppedBlank: 0 };
  }
  const sheet = wb.Sheets[sheetName];

  // Read as a matrix so we control header handling & duplicate disambiguation.
  // `raw: true` hands us the native cell values (Date objects for date cells,
  // since we read with `cellDates: true`) rather than SheetJS's locale-format
  // strings — our `cellToString` then normalizes them deterministically.
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: true,
  });

  if (matrix.length === 0) {
    return { headers: [], rows: [], droppedBlank: 0 };
  }

  const rawHeaderRow = matrix[0] ?? [];
  const headers: string[] = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < rawHeaderRow.length; i++) {
    let header = cleanHeader(rawHeaderRow[i]);
    if (header === "") header = `Column ${i + 1}`;
    const count = seen.get(header) ?? 0;
    seen.set(header, count + 1);
    headers.push(count === 0 ? header : `${header} (${count + 1})`);
  }

  const rows: RawRow[] = [];
  let droppedBlank = 0;
  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r] ?? [];
    const row: RawRow = {};
    let hasValue = false;
    for (let c = 0; c < headers.length; c++) {
      const value = cellToString(cells[c]);
      row[headers[c]] = value;
      if (value !== "") hasValue = true;
    }
    if (!hasValue) {
      droppedBlank++;
      continue;
    }
    rows.push(row);
  }

  return { headers, rows, droppedBlank };
}

/* ------------------------------------------------------------------ */
/* Auto-mapping                                                        */
/* ------------------------------------------------------------------ */

/** Normalizes a header for fuzzy matching: lowercase alphanumerics only. */
function normalizeHeader(header: string): string {
  return header
    .replace(BOM, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Auto-matches source headers to canonical fields using each column's alias
 * list (case/space/punctuation-insensitive). A source header is consumed by at
 * most one field; the first field that claims it wins (IMPORT_COLUMNS order).
 */
export function autoMapColumns(headers: string[]): ColumnMapping {
  const normalized = headers.map((h) => ({ header: h, norm: normalizeHeader(h) }));
  const taken = new Set<string>();
  const mapping: ColumnMapping = {};

  for (const column of IMPORT_COLUMNS) {
    const aliasSet = new Set(column.aliases.map(normalizeHeader));
    const match = normalized.find(
      (h) => !taken.has(h.header) && aliasSet.has(h.norm),
    );
    if (match) {
      mapping[column.key] = match.header;
      taken.add(match.header);
    }
  }
  return mapping;
}

/* ------------------------------------------------------------------ */
/* Coercion helpers                                                    */
/* ------------------------------------------------------------------ */

const STOCK_ALIASES: Record<string, StockStatus> = {
  instock: "IN_STOCK",
  in: "IN_STOCK",
  available: "IN_STOCK",
  yes: "IN_STOCK",
  y: "IN_STOCK",
  true: "IN_STOCK",
  low: "LOW",
  lowstock: "LOW",
  limited: "LOW",
  outofstock: "OUT_OF_STOCK",
  out: "OUT_OF_STOCK",
  oos: "OUT_OF_STOCK",
  no: "OUT_OF_STOCK",
  n: "OUT_OF_STOCK",
  false: "OUT_OF_STOCK",
};

const STATUS_ALIASES: Record<string, EntityStatus> = {
  active: "ACTIVE",
  yes: "ACTIVE",
  y: "ACTIVE",
  true: "ACTIVE",
  published: "ACTIVE",
  live: "ACTIVE",
  "1": "ACTIVE",
  inactive: "INACTIVE",
  no: "INACTIVE",
  n: "INACTIVE",
  false: "INACTIVE",
  draft: "INACTIVE",
  hidden: "INACTIVE",
  "0": "INACTIVE",
};

function normEnum(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Parses a plain integer, allowing thousands separators ("1,000"). */
function parseIntSafe(value: string): number | null {
  const cleaned = value.trim().replace(/,/g, "");
  if (cleaned === "") return null;
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) ? n : null;
}

/** Splits a tag cell on commas / semicolons / pipes; trims & dedupes. */
function parseTags(value: string): string[] {
  const parts = value
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return Array.from(new Set(parts)).slice(0, 20);
}

/* ------------------------------------------------------------------ */
/* Variant column context                                              */
/* ------------------------------------------------------------------ */

/**
 * Resolves the {@link VariantColumnContext} for variant grouping, or `null`
 * when the sheet has no `variantOf` column mapped (⇒ plain single-product
 * import, no variant handling at all).
 *
 * OPTION COLUMNS are inferred: every source header that is NOT consumed by any
 * canonical field mapping and is NOT the `variantOf` column becomes an option
 * axis (Capacity, Color, …), in sheet order. When `headers` is omitted we can't
 * infer option columns, so variant handling is disabled.
 */
export function resolveVariantContext(
  mapping: ColumnMapping,
  headers: string[] | undefined,
): VariantColumnContext | null {
  const variantOf = mapping.variantOf;
  if (!variantOf || !headers || headers.length === 0) return null;

  // Every header claimed by a canonical field (including variantOf itself).
  const mappedHeaders = new Set<string>();
  for (const key of Object.keys(mapping) as ImportField[]) {
    const header = mapping[key];
    if (header) mappedHeaders.add(header);
  }

  const optionHeaders = headers.filter((h) => !mappedHeaders.has(h));

  return {
    variantOf,
    // The variant's own SKU is read from the mapped `sku` column.
    variantSku: mapping.sku,
    name: mapping.name,
    category: mapping.category,
    brand: mapping.brand,
    description: mapping.description,
    tags: mapping.tags,
    price: mapping.price,
    mrp: mapping.mrp,
    moq: mapping.moq,
    stock: mapping.stock,
    status: mapping.status,
    optionHeaders,
  };
}

/* ------------------------------------------------------------------ */
/* 2. validateRows                                                     */
/* ------------------------------------------------------------------ */

const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Validates and coerces every raw row against the canonical schema using the
 * supplied column mapping. Produces per-cell errors, classifies each row as a
 * create (new SKU) or update (SKU already in the catalog), and flags in-file
 * duplicate SKUs. Pure & synchronous — no DB access.
 *
 * VARIANT ROWS: when `mapping.variantOf` is set AND `headers` is supplied, rows
 * carrying a `variantOf` value are grouped into variant PRODUCTS and validated
 * by the variant engine (import-variants). Such rows get `operation: "variant"`
 * (or "invalid" when they have errors) and a `variant` meta block, and the
 * grouped result is returned in `variantGroups`. Rows with an empty `variantOf`
 * cell — and every row when no `variantOf` column is mapped — are validated as
 * single products EXACTLY as before, so existing imports are unaffected.
 *
 * @param rows          raw rows from parseWorkbook
 * @param mapping       field → source header (see autoMapColumns)
 * @param existingSkus  lowercase SKUs already in the catalog (for create/update)
 * @param categories    known categories (matched by name, case-insensitive)
 * @param headers       original sheet headers (needed to infer option columns)
 */
export function validateRows(
  rows: RawRow[],
  mapping: ColumnMapping,
  existingSkus: Iterable<string>,
  categories: CategoryRef[],
  headers?: string[],
): ValidateResult {
  const existing = new Set(
    Array.from(existingSkus, (s) => s.trim().toLowerCase()),
  );
  const categoryByName = new Map(
    categories.map((c) => [c.name.trim().toLowerCase(), c]),
  );

  /* ---- variant grouping (opt-in via a mapped `variantOf` column) ---- */
  const variantCtx = resolveVariantContext(mapping, headers);
  const variantResult = variantCtx
    ? groupVariantRows(rows, variantCtx, categories)
    : { variantRowIndices: new Set<number>(), groups: [] as VariantGroup[] };
  const variantRowIndices = variantResult.variantRowIndices;

  // Index groups by their canonical (lowercased) parent SKU for per-row lookup.
  const groupByParent = new Map<string, VariantGroup>();
  for (const g of variantResult.groups) {
    groupByParent.set(g.parentSku.trim().toLowerCase(), g);
  }

  // First pass: count SKU occurrences within the file for duplicate detection.
  // Variant rows are excluded — their SKUs live in a separate namespace handled
  // by the variant engine, so they must not clash with single-product dup logic.
  const skuCounts = new Map<string, number>();
  const skuHeader = mapping.sku;
  if (skuHeader) {
    let idx = -1;
    for (const row of rows) {
      idx += 1;
      if (variantRowIndices.has(idx)) continue;
      const sku = (row[skuHeader] ?? "").trim().toLowerCase();
      if (sku) skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1);
    }
  }

  const previews: PreviewRow[] = [];
  let creates = 0;
  let updates = 0;
  let invalid = 0;
  let variantRowCount = 0;

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // +1 header, +1 for 1-based

    // ---- variant row: validated by the variant engine, not the single path ----
    if (variantRowIndices.has(index)) {
      variantRowCount += 1;
      previews.push(
        buildVariantPreviewRow(row, index, rowNumber, variantCtx!, groupByParent),
      );
      if (previews[previews.length - 1]!.operation === "invalid") invalid += 1;
      return;
    }

    const errors: CellError[] = [];
    const values: CoercedRow = {};
    const raw = {} as Record<ImportField, string>;

    // Read each mapped field's raw string.
    for (const column of IMPORT_COLUMNS) {
      const header = mapping[column.key];
      raw[column.key] = header ? (row[header] ?? "").trim() : "";
    }

    const push = (field: ImportField, message: string) =>
      errors.push({ field, message });

    // sku (identity) — required, format-checked, dup-in-file flagged.
    const skuRaw = raw.sku;
    let skuLower = "";
    if (!skuRaw) {
      push("sku", "SKU is required.");
    } else if (skuRaw.length > 64) {
      push("sku", "SKU is too long (max 64).");
    } else if (!SKU_RE.test(skuRaw)) {
      push("sku", "SKU may only contain letters, digits, dots, underscores and hyphens.");
    } else {
      skuLower = skuRaw.toLowerCase();
      values.sku = skuRaw;
      if ((skuCounts.get(skuLower) ?? 0) > 1) {
        push("sku", "Duplicate SKU within this file.");
      }
    }

    const isUpdate = skuLower !== "" && existing.has(skuLower);

    // name — required for a create; if present, length-checked.
    const nameRaw = raw.name;
    if (nameRaw) {
      if (nameRaw.length < 2) push("name", "Name is too short (min 2).");
      else if (nameRaw.length > 160) push("name", "Name is too long (max 160).");
      else values.name = nameRaw;
    } else if (!isUpdate) {
      push("name", "Name is required.");
    }

    // category — required for a create; must resolve to a known category.
    const categoryRaw = raw.category;
    if (categoryRaw) {
      const match = categoryByName.get(categoryRaw.toLowerCase());
      if (!match) {
        push("category", `Unknown category "${categoryRaw}".`);
      } else {
        values.categoryId = match.id;
        values.categoryName = match.name;
      }
    } else if (!isUpdate) {
      push("category", "Category is required.");
    }

    // price — required for a create; rupees → paise, must be > 0.
    const priceRaw = raw.price;
    if (priceRaw) {
      const paise = parseRupees(priceRaw);
      if (paise === null || paise <= 0) {
        push("price", `"${priceRaw}" is not a valid price.`);
      } else {
        values.price = paise;
      }
    } else if (!isUpdate) {
      push("price", "Price is required.");
    }

    // mrp — optional; rupees → paise; must be ≥ price when both present.
    const mrpRaw = raw.mrp;
    if (mrpRaw) {
      const paise = parseRupees(mrpRaw);
      if (paise === null || paise <= 0) {
        push("mrp", `"${mrpRaw}" is not a valid MRP.`);
      } else {
        values.mrp = paise;
        if (values.price !== undefined && paise < values.price) {
          push("mrp", "MRP must be greater than or equal to price.");
        }
      }
    }

    // brand — optional text.
    if (raw.brand) {
      if (raw.brand.length > 80) push("brand", "Brand is too long (max 80).");
      else values.brand = raw.brand;
    }

    // moq — optional positive integer.
    const moqRaw = raw.moq;
    if (moqRaw) {
      const n = parseIntSafe(moqRaw);
      if (n === null || n <= 0) push("moq", `"${moqRaw}" is not a valid MOQ.`);
      else values.moq = n;
    }

    // stock — optional enum.
    const stockRaw = raw.stock;
    if (stockRaw) {
      const direct = stockStatusSchema.safeParse(stockRaw.toUpperCase());
      const resolved = direct.success
        ? direct.data
        : STOCK_ALIASES[normEnum(stockRaw)];
      if (!resolved) push("stock", `Unknown stock status "${stockRaw}".`);
      else values.stockStatus = resolved;
    }

    // status — optional enum.
    const statusRaw = raw.status;
    if (statusRaw) {
      const direct = entityStatusSchema.safeParse(statusRaw.toUpperCase());
      const resolved = direct.success
        ? direct.data
        : STATUS_ALIASES[normEnum(statusRaw)];
      if (!resolved) push("status", `Unknown status "${statusRaw}".`);
      else values.status = resolved;
    }

    // tags — optional, split & deduped.
    if (raw.tags) values.tags = parseTags(raw.tags);

    // description — optional text.
    if (raw.description) {
      if (raw.description.length > 5000) {
        push("description", "Description is too long (max 5000).");
      } else {
        values.description = raw.description;
      }
    }

    const operation: RowOperation =
      errors.length > 0 ? "invalid" : isUpdate ? "update" : "create";

    if (operation === "invalid") invalid++;
    else if (operation === "update") updates++;
    else creates++;

    previews.push({
      id: `import-${rowNumber}`,
      rowNumber,
      raw,
      values,
      errors,
      operation,
    });
  });

  const variantGroups: VariantGroupSummary[] = variantResult.groups.map((g) => {
    const errorsByRow: VariantGroupSummary["errorsByRow"] = {};
    for (const [rowNumber, errs] of g.errorsByRow) {
      errorsByRow[rowNumber] = errs.map((e) => ({
        header: e.header,
        message: e.message,
      }));
    }
    return {
      parentSku: g.parentSku,
      product: g.product,
      optionTypes: g.optionTypes,
      variants: g.variants,
      rowNumbers: g.rowNumbers,
      variantCount: g.rowNumbers.length,
      valid: g.valid,
      errorsByRow,
    };
  });

  return {
    rows: previews,
    summary: {
      total: previews.length,
      creates,
      updates,
      invalid,
      variantProducts: variantGroups.length,
      variantRows: variantRowCount,
    },
    variantGroups,
  };
}

/* ------------------------------------------------------------------ */
/* Variant preview row projection                                      */
/* ------------------------------------------------------------------ */

/**
 * Projects a single variant row to a {@link PreviewRow}. The `raw` block reads
 * the canonical fields (name/sku/price/…) so the grid renders familiar columns;
 * the option values are folded into `variant.optionValues`. Errors come from
 * the row's group (keyed by source header) and are re-keyed to canonical
 * {@link ImportField}s where possible so the grid can highlight the right cell —
 * option-column errors are surfaced against a synthetic field bucket.
 */
function buildVariantPreviewRow(
  row: RawRow,
  index: number,
  rowNumber: number,
  ctx: VariantColumnContext,
  groupByParent: Map<string, VariantGroup>,
): PreviewRow {
  const raw = {} as Record<ImportField, string>;
  for (const column of IMPORT_COLUMNS) {
    const header = ctx[column.key as keyof VariantColumnContext];
    raw[column.key] =
      typeof header === "string" ? (row[header] ?? "").trim() : "";
  }
  // The variant's own SKU comes from the resolved variantSku header.
  if (ctx.variantSku) raw.sku = (row[ctx.variantSku] ?? "").trim();
  raw.variantOf = (row[ctx.variantOf] ?? "").trim();

  const parentKey = raw.variantOf.toLowerCase();
  const group = groupByParent.get(parentKey);

  // Collect this row's errors from the group and re-key by import field.
  const errors: CellError[] = [];
  const optionValues: OptionValues = {};
  let isGroupLead = false;
  if (group) {
    isGroupLead = group.rowNumbers[0] === rowNumber;
    for (const v of group.variants) {
      if (v.rowNumber === rowNumber) {
        Object.assign(optionValues, v.optionValues);
        break;
      }
    }
    // If no coerced variant (row had errors), still surface the option cells.
    if (Object.keys(optionValues).length === 0) {
      for (const header of ctx.optionHeaders) {
        const val = (row[header] ?? "").trim();
        if (val) optionValues[header] = val;
      }
    }
    const rowErrors = group.errorsByRow.get(rowNumber) ?? [];
    for (const e of rowErrors) {
      errors.push({ field: headerToField(ctx, e.header), message: e.message });
    }
  }

  const operation: RowOperation = errors.length > 0 ? "invalid" : "variant";

  return {
    id: `import-${rowNumber}`,
    rowNumber,
    raw,
    values: {},
    errors,
    operation,
    variant: {
      parentSku: raw.variantOf,
      optionValues,
      isGroupLead,
    },
  };
}

/**
 * Maps a variant error's source header back to a canonical {@link ImportField}
 * for cell highlighting. Option-column headers (which have no canonical field)
 * fall back to `variantOf` so the error still attaches to a visible cell.
 */
function headerToField(
  ctx: VariantColumnContext,
  header: string,
): ImportField {
  const entries: Array<[ImportField, string | undefined]> = [
    ["name", ctx.name],
    ["category", ctx.category],
    ["brand", ctx.brand],
    ["description", ctx.description],
    ["tags", ctx.tags],
    ["price", ctx.price],
    ["mrp", ctx.mrp],
    ["moq", ctx.moq],
    ["stock", ctx.stock],
    ["status", ctx.status],
    ["sku", ctx.variantSku],
    ["variantOf", ctx.variantOf],
  ];
  for (const [field, h] of entries) {
    if (h && h === header) return field;
  }
  // Option columns and anything else attach to the variantOf cell.
  return "variantOf";
}

/* ------------------------------------------------------------------ */
/* Preview → create/update payloads                                    */
/* ------------------------------------------------------------------ */

/** Builds the createProduct input from a valid *create* preview row. */
function toCreateInput(values: CoercedRow): CreateProductInput {
  // required fields are guaranteed present for a valid create row.
  return {
    categoryId: values.categoryId as string,
    name: values.name as string,
    sku: values.sku as string,
    brand: values.brand,
    description: values.description,
    price: values.price as number,
    mrp: values.mrp,
    moq: values.moq,
    stockStatus: values.stockStatus ?? "IN_STOCK",
    status: values.status ?? "ACTIVE",
    tags: values.tags ?? [],
    images: [],
  };
}

/** Builds the (partial) updateProduct patch from a valid *update* preview row. */
function toUpdatePatch(values: CoercedRow): UpdateProductInput {
  const patch: UpdateProductInput = {};
  if (values.name !== undefined) patch.name = values.name;
  if (values.categoryId !== undefined) patch.categoryId = values.categoryId;
  if (values.brand !== undefined) patch.brand = values.brand;
  if (values.description !== undefined) patch.description = values.description;
  if (values.price !== undefined) patch.price = values.price;
  if (values.mrp !== undefined) patch.mrp = values.mrp;
  if (values.moq !== undefined) patch.moq = values.moq;
  if (values.stockStatus !== undefined) patch.stockStatus = values.stockStatus;
  if (values.status !== undefined) patch.status = values.status;
  if (values.tags !== undefined) patch.tags = values.tags;
  return patch;
}

/* ------------------------------------------------------------------ */
/* 3. buildErrorCsv                                                    */
/* ------------------------------------------------------------------ */

/** Escapes a value for CSV (quote-wraps and doubles inner quotes). */
function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Renders a downloadable CSV of every problem row: its source row number, the
 * SKU, the offending field, and the human message. One line per error so a
 * user can fix the sheet and re-upload. Prefixed with a UTF-8 BOM so Excel
 * opens it with the right encoding.
 */
export function buildErrorCsv(
  entries: Array<{ rowNumber: number; sku: string; field: string; message: string }>,
): string {
  const header = ["Row", "SKU", "Field", "Error"];
  const lines = [header.join(",")];
  for (const e of entries) {
    lines.push(
      [
        csvCell(String(e.rowNumber)),
        csvCell(e.sku),
        csvCell(e.field),
        csvCell(e.message),
      ].join(","),
    );
  }
  return "﻿" + lines.join("\r\n");
}

/** Flattens preview rows into per-cell error entries for the CSV report. */
export function collectErrorEntries(
  rows: PreviewRow[],
): Array<{ rowNumber: number; sku: string; field: string; message: string }> {
  const out: Array<{ rowNumber: number; sku: string; field: string; message: string }> = [];
  for (const row of rows) {
    for (const err of row.errors) {
      out.push({
        rowNumber: row.rowNumber,
        sku: row.raw.sku,
        field: COLUMN_BY_KEY[err.field].label,
        message: err.message,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Template                                                            */
/* ------------------------------------------------------------------ */

/**
 * Builds an XLSX template workbook (as a Uint8Array).
 *
 * Sheet 1 "Products" — the canonical header row + one illustrative
 * single-product example. This is the sheet the importer reads. The last
 * column, "Variant Of (parent SKU)", is left blank for plain products.
 *
 * Sheet 2 "Variants example" — a READ-ONLY illustration (never parsed, since the
 * importer only reads the first sheet) showing the variant format: a 2-axis
 * (Capacity × Color) product where four rows share the same parent SKU and add
 * "Capacity"/"Color" OPTION columns. It documents, in the file itself, how to
 * split a product into variants.
 */
export function buildTemplateWorkbook(): Uint8Array {
  const headers = IMPORT_COLUMNS.map((c) => c.label);
  // Single-product example: trailing "" leaves the variantOf column blank.
  const example = [
    "Kingston Fury 16GB DDR4",
    "KF-FURY-16",
    "Kingston",
    "RAM",
    "4,999",
    "6,499",
    "10",
    "IN_STOCK",
    "ACTIVE",
    "ddr4,gaming",
    "16GB 3200MHz desktop memory",
    "", // Variant Of — blank ⇒ a plain single product
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Products");

  // --- documentation sheet for the variant format ---
  const variantHeaders = [
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
  // Four variants (2 capacities × 2 colors) of one product "PB-PRO". Every row
  // carries the SAME parent SKU in "Variant Of"; product fields come from the
  // first row; each row's own SKU/price/options define one variant.
  const variantRows = [
    ["Anker PowerBank Pro", "PBP-10K-BLK", "Anker", "Power Bank", "2,499", "2,999", "IN_STOCK", "ACTIVE", "PB-PRO", "10000mAh", "Black"],
    ["", "PBP-10K-WHT", "", "", "2,499", "2,999", "IN_STOCK", "ACTIVE", "PB-PRO", "10000mAh", "White"],
    ["", "PBP-20K-BLK", "", "", "3,499", "3,999", "LOW", "ACTIVE", "PB-PRO", "20000mAh", "Black"],
    ["", "PBP-20K-WHT", "", "", "3,499", "3,999", "OUT_OF_STOCK", "ACTIVE", "PB-PRO", "20000mAh", "White"],
  ];
  const noteRow = [
    "Tip: rows sharing the same \"Variant Of\" value become one variant product. Add any option columns (e.g. Capacity, Color) — the axes are inferred from them.",
  ];
  const variantWs = XLSX.utils.aoa_to_sheet([
    variantHeaders,
    ...variantRows,
    [],
    noteRow,
  ]);
  XLSX.utils.book_append_sheet(wb, variantWs, "Variants example");

  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Uint8Array(out);
}

/* ------------------------------------------------------------------ */
/* 4. commitImport (the only DB-touching function)                     */
/* ------------------------------------------------------------------ */

export interface CommitInput {
  /** The full set of preview rows (invalid rows are skipped automatically). */
  rows: PreviewRow[];
  /**
   * Validated variant groups from {@link validateRows} (empty for a plain
   * single-product import). Each valid group is committed as ONE variant
   * product through the audited variants service; invalid groups are skipped
   * with their reasons. Variant preview rows in `rows` are NOT re-committed by
   * the single-product loop — they belong to these groups.
   */
  variantGroups?: VariantGroupSummary[];
}

/**
 * Commits valid preview rows through the audited product service layer.
 * Invalid rows are skipped with their (already-known) reasons; each valid row
 * is created or updated individually so one bad row can't abort the batch, and
 * every failure is captured with a human reason. Returns counts + a CSV of all
 * skipped/failed rows.
 *
 * NOTE: MongoDB does not support cross-document transactions on a standalone
 * server, so we commit row-by-row with per-row error isolation rather than a
 * single `$transaction`. Each service call is itself atomic and audited.
 */
export async function commitImport({
  rows,
  variantGroups = [],
}: CommitInput): Promise<CommitResult> {
  let created = 0;
  let updated = 0;
  const skipped: SkippedRow[] = [];
  const errorEntries: Array<{
    rowNumber: number;
    sku: string;
    field: string;
    message: string;
  }> = [];

  // Resolve every distinct brand name referenced by a committable row to a
  // Brand id up front — auto-creating any that don't yet exist — so we hit the
  // DB once per brand rather than once per product row. `newBrands` records the
  // masters minted here for the import summary.
  const resolver = await createBrandResolver(rows);

  for (const row of rows) {
    // Variant rows are committed via their group below, never here. Invalid
    // variant rows already surface their errors through the group's `valid`
    // flag, so we don't double-report them in the single-product skip list.
    if (row.operation === "variant") continue;
    if (row.operation === "invalid" && row.variant) {
      // An invalid variant row: record its errors for the CSV but let the group
      // handle the "skipped" summary, so per-row and per-product reporting align.
      for (const err of row.errors) {
        errorEntries.push({
          rowNumber: row.rowNumber,
          sku: row.raw.sku,
          field: COLUMN_BY_KEY[err.field].label,
          message: err.message,
        });
      }
      continue;
    }
    if (row.operation === "invalid" || row.errors.length > 0) {
      const reason =
        row.errors[0]?.message ?? "Row has validation errors.";
      skipped.push({ rowNumber: row.rowNumber, sku: row.raw.sku, reason });
      for (const err of row.errors) {
        errorEntries.push({
          rowNumber: row.rowNumber,
          sku: row.raw.sku,
          field: COLUMN_BY_KEY[err.field].label,
          message: err.message,
        });
      }
      continue;
    }

    // Map this row's brand name (if any) to a Brand id (created on demand).
    const brandId = resolver.idFor(row.values.brand);

    try {
      if (row.operation === "create") {
        const product = await createProduct(toCreateInput(row.values));
        if (brandId) await linkProductBrand(product.id, brandId);
        created++;
      } else {
        const sku = row.values.sku as string;
        const id = await resolveIdBySku(sku);
        if (!id) {
          const reason = `SKU "${sku}" no longer exists in the catalog.`;
          skipped.push({ rowNumber: row.rowNumber, sku, reason });
          errorEntries.push({
            rowNumber: row.rowNumber,
            sku,
            field: "SKU",
            message: reason,
          });
          continue;
        }
        await updateProduct(id, toUpdatePatch(row.values));
        // Only re-link the brand when the row actually carried a brand value,
        // so an update that omits the brand column leaves the existing link
        // untouched (mirrors how omitted fields are left alone above).
        if (brandId) await linkProductBrand(id, brandId);
        updated++;
      }
    } catch (error) {
      const reason = isProductServiceError(error)
        ? error.message
        : "Unexpected error while saving this row.";
      skipped.push({ rowNumber: row.rowNumber, sku: row.raw.sku, reason });
      errorEntries.push({
        rowNumber: row.rowNumber,
        sku: row.raw.sku,
        field: "—",
        message: reason,
      });
      if (!isProductServiceError(error)) {
        console.error(
          `[import] row ${row.rowNumber} (${row.raw.sku}) failed:`,
          error,
        );
      }
    }
  }

  // ---- variant groups: one audited variants-service call per parent ----
  const variantOutcome = await commitVariantGroups(
    variantGroups,
    skipped,
    errorEntries,
  );

  return {
    created,
    updated,
    skipped,
    variantProductsCreated: variantOutcome.created,
    variantProductsUpdated: variantOutcome.updated,
    variantsWritten: variantOutcome.variantsWritten,
    errorsCsv: errorEntries.length > 0 ? buildErrorCsv(errorEntries) : "",
    newBrands: resolver.newBrands,
  };
}

/* ------------------------------------------------------------------ */
/* Variant-group commit (audited variants service)                     */
/* ------------------------------------------------------------------ */

/**
 * Commits every VALID variant group as one variant product, through the audited
 * variants service (`saveProductVariants`), which enforces the catalog
 * invariants (global SKU uniqueness, no duplicate combos, recomputed FROM
 * price). The parent product is created when its `variantOf` SKU is new, or
 * looked up and reused when it already exists.
 *
 * Per-group error isolation mirrors the single-product loop: one bad group
 * can't abort the batch. Invalid groups (any row with an error) are skipped
 * with a reason. Category resolution / product creation reuses the same product
 * service so slugs, brand links and audit entries stay consistent.
 */
async function commitVariantGroups(
  groups: VariantGroupSummary[],
  skipped: SkippedRow[],
  errorEntries: Array<{
    rowNumber: number;
    sku: string;
    field: string;
    message: string;
  }>,
): Promise<{ created: number; updated: number; variantsWritten: number }> {
  if (groups.length === 0) {
    return { created: 0, updated: 0, variantsWritten: 0 };
  }

  const { saveProductVariants } = await import(
    "@/server/services/variants"
  );

  let created = 0;
  let updated = 0;
  let variantsWritten = 0;

  for (const group of groups) {
    const leadRow = group.rowNumbers[0] ?? 0;

    if (!group.valid) {
      skipped.push({
        rowNumber: leadRow,
        sku: group.parentSku,
        reason: `Variant product "${group.parentSku}" has row errors and was skipped.`,
      });
      continue;
    }

    try {
      const parent = await resolveOrCreateVariantParent(group);
      const result = await saveProductVariants(parent.id, {
        hasVariants: true,
        optionTypes: group.optionTypes,
        variants: group.variants.map((v, i) => ({
          id: null,
          optionValues: v.optionValues,
          sku: v.sku,
          price: v.price,
          mrp: v.mrp,
          moq: v.moq,
          stockStatus: v.stockStatus,
          status: v.status,
          isDefault: i === 0,
          sortOrder: i,
        })),
      });
      variantsWritten += result.variants.length;
      if (parent.created) created++;
      else updated++;
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : "Unexpected error while saving this variant product.";
      skipped.push({ rowNumber: leadRow, sku: group.parentSku, reason });
      errorEntries.push({
        rowNumber: leadRow,
        sku: group.parentSku,
        field: "Variant Of (parent SKU)",
        message: reason,
      });
      console.error(
        `[import] variant product "${group.parentSku}" failed:`,
        error,
      );
    }
  }

  return { created, updated, variantsWritten };
}

/**
 * Resolves the parent product id for a variant group: reuses an existing
 * product whose SKU matches `parentSku` (case-insensitive), else creates a new
 * product from the group's product-level fields via the audited product
 * service. Returns whether the parent was freshly created so the summary can
 * distinguish created-vs-updated variant products.
 */
async function resolveOrCreateVariantParent(
  group: VariantGroupSummary,
): Promise<{ id: string; created: boolean }> {
  const existingId = await resolveIdBySku(group.parentSku);
  if (existingId) {
    return { id: existingId, created: false };
  }

  // Create the parent from the group's product-level fields. A variant product
  // needs a category + name + a base price; use the group's min variant price
  // as the seed base price (recomputeFrom overwrites it right after).
  const { prisma } = await import("@/server/db");
  const categoryName = group.product.categoryName;
  let categoryId: string | undefined;
  if (categoryName) {
    const cat = await prisma.category.findFirst({
      where: { name: { equals: categoryName, mode: "insensitive" } },
      select: { id: true },
    });
    categoryId = cat?.id;
  }
  if (!categoryId) {
    throw new Error(
      `Category "${categoryName ?? ""}" for variant product "${group.parentSku}" was not found.`,
    );
  }

  const basePrice =
    group.variants.length > 0
      ? Math.min(...group.variants.map((v) => v.price))
      : 0;
  if (basePrice <= 0) {
    throw new Error(
      `Variant product "${group.parentSku}" has no valid variant price.`,
    );
  }

  const product = await createProduct({
    categoryId,
    name: group.product.name ?? group.parentSku,
    sku: group.parentSku,
    brand: group.product.brand,
    description: group.product.description,
    price: basePrice,
    stockStatus: "IN_STOCK",
    status: "ACTIVE",
    tags: group.product.tags ?? [],
    images: [],
  });
  return { id: product.id, created: true };
}

/**
 * Resolves an existing product id by SKU (case-insensitive). Imported here
 * lazily to keep the pure parse/validate layers free of a Prisma dependency at
 * module-eval time for the unit tests.
 */
async function resolveIdBySku(sku: string): Promise<string | null> {
  const { prisma } = await import("@/server/db");
  const row = await prisma.product.findFirst({
    where: { sku: { equals: sku, mode: "insensitive" } },
    select: { id: true },
  });
  return row?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* Brand resolution (Brand master mapping)                             */
/* ------------------------------------------------------------------ */

/**
 * A brand-name → Brand-id resolver bound to a single import run. Every distinct
 * brand value across the committable rows is resolved once, up front: a
 * case-insensitive match against an existing Brand reuses its id; anything with
 * no match is AUTO-CREATED (with a unique slug) and its id used thereafter.
 *
 * Product wiring keeps the legacy `brand` STRING (written by the product
 * service) AND sets the canonical `brandId` foreign key here, so imports no
 * longer produce free-text brand typos disconnected from the master.
 */
interface BrandResolver {
  /** Brand id for a raw brand name (undefined when the row had no brand). */
  idFor(brandName: string | undefined): string | undefined;
  /** Names of brands newly created during this run (display order). */
  newBrands: string[];
}

async function createBrandResolver(rows: PreviewRow[]): Promise<BrandResolver> {
  // Distinct, trimmed brand names from rows that will actually be committed,
  // keyed case-insensitively but preserving the first-seen display casing.
  const byLower = new Map<string, string>();
  for (const row of rows) {
    if (row.operation === "invalid" || row.errors.length > 0) continue;
    const name = row.values.brand?.trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    if (!byLower.has(lower)) byLower.set(lower, name);
  }

  const idByLower = new Map<string, string>();
  const newBrands: string[] = [];

  if (byLower.size === 0) {
    return { idFor: () => undefined, newBrands };
  }

  const { prisma } = await import("@/server/db");
  const { makeUniqueSlug } = await import("@/lib/slug");

  // One pass to bind every distinct name to an id, creating on demand.
  for (const [lower, displayName] of byLower) {
    const existing = await prisma.brand.findFirst({
      where: { name: { equals: displayName, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) {
      idByLower.set(lower, existing.id);
      continue;
    }
    const slug = await makeUniqueSlug(displayName, async (candidate) => {
      const hit = await prisma.brand.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      return hit !== null;
    });
    const brand = await prisma.brand.create({
      data: { name: displayName, slug },
      select: { id: true },
    });
    idByLower.set(lower, brand.id);
    newBrands.push(displayName);
  }

  return {
    idFor(brandName) {
      const key = brandName?.trim().toLowerCase();
      if (!key) return undefined;
      return idByLower.get(key);
    },
    newBrands,
  };
}

/** Sets a product's canonical `brandId` foreign key (leaves `brand` string). */
async function linkProductBrand(productId: string, brandId: string): Promise<void> {
  const { prisma } = await import("@/server/db");
  await prisma.product.update({
    where: { id: productId },
    data: { brandId },
  });
}

/** Exposed for callers that need the canonical field→label lookup. */
export function fieldLabel(field: ImportField): string {
  return COLUMN_BY_KEY[field].label;
}

/** Derives a preview slug for display (never persisted here). */
export function previewSlug(name: string): string {
  return slugify(name);
}
