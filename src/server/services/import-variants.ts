/**
 * Variant-row import (PRD Phase 11 fast-follow F2) — the PURE grouping &
 * validation layer that teaches the bulk importer to ingest PRODUCT VARIANTS
 * alongside plain single-product rows, WITHOUT changing the behaviour of any
 * existing single-product row.
 *
 * ─── The format ────────────────────────────────────────────────────────────
 * A row becomes a VARIANT row when it carries a value in the `variantOf`
 * column. That value is the SKU of the PARENT product every variant in the
 * group hangs off of. Rows sharing the same `variantOf` value form ONE variant
 * product:
 *
 *   - Product-level fields (name, category, brand, description, tags) come from
 *     the group's FIRST row (the "header" row for the group). Later rows may
 *     repeat or omit them; the first non-empty value wins and mismatches are
 *     flagged so nothing is silently dropped.
 *   - Each variant row contributes its OWN variant: its `sku`, `price`, `mrp`,
 *     `moq`, `stock`, `status`, plus its OPTION VALUES read from the option
 *     columns (any header that isn't a canonical import field and isn't the
 *     `variantOf` column — e.g. "Capacity", "Color").
 *   - `optionTypes` (the axes) are INFERRED from the distinct axis→value combos
 *     seen across the group's rows, in first-seen order.
 *
 * A row with an EMPTY `variantOf` cell is a plain single-product row and is
 * validated by the existing engine exactly as before. When the sheet has no
 * `variantOf` column mapped at all, this module is a complete no-op.
 *
 * ─── Purity ────────────────────────────────────────────────────────────────
 * Everything here is pure & synchronous — no DB, no I/O. The DB commit lives in
 * import.ts (`commitVariantGroups`), which drives the audited variants service.
 * Money is integer paise; rupee text ("₹1,299.50") is parsed via lib/money.
 */

import { parseRupees } from "@/lib/money";
import {
  entityStatusSchema,
  stockStatusSchema,
  type EntityStatus,
  type StockStatus,
} from "@/lib/schemas/shared";
import type { OptionTypesInput, OptionValues } from "@/lib/schemas/variant";

/* ------------------------------------------------------------------ */
/* The variantOf column key + shared enum coercion                     */
/* ------------------------------------------------------------------ */

/**
 * The canonical field key for the "parent SKU" column. It is a first-class
 * {@link ImportField} in import.ts so it participates in auto-mapping and the
 * column mapper, but its presence in the mapping is what switches a row from
 * the single-product path onto the variant path.
 */
export const VARIANT_OF_FIELD = "variantOf" as const;

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

function coerceStock(value: string): StockStatus | null {
  const direct = stockStatusSchema.safeParse(value.toUpperCase());
  if (direct.success) return direct.data;
  return STOCK_ALIASES[normEnum(value)] ?? null;
}

function coerceStatus(value: string): EntityStatus | null {
  const direct = entityStatusSchema.safeParse(value.toUpperCase());
  if (direct.success) return direct.data;
  return STATUS_ALIASES[normEnum(value)] ?? null;
}

function parseIntSafe(value: string): number | null {
  const cleaned = value.trim().replace(/,/g, "");
  if (cleaned === "") return null;
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) ? n : null;
}

function parseTags(value: string): string[] {
  const parts = value
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return Array.from(new Set(parts)).slice(0, 20);
}

const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/* ------------------------------------------------------------------ */
/* Column context                                                      */
/* ------------------------------------------------------------------ */

/**
 * The subset of the column mapping this module needs to read a variant row.
 * `variantOf` MUST be present for any variant grouping to happen at all.
 */
export interface VariantColumnContext {
  /** Source header for the parent SKU column (presence enables variants). */
  variantOf: string;
  /**
   * Source header the variant's own SKU is read from. The caller resolves this
   * to a dedicated variant-SKU column when one is mapped, otherwise to the
   * canonical `sku` column's header. Undefined ⇒ no SKU column at all.
   */
  variantSku?: string;
  /** Source headers for the canonical product/variant fields. */
  name?: string;
  category?: string;
  brand?: string;
  description?: string;
  tags?: string;
  price?: string;
  mrp?: string;
  moq?: string;
  stock?: string;
  status?: string;
  /** GST override headers (product-level; applied to the parent product). */
  hsnCode?: string;
  gstRate?: string;
  taxInclusive?: string;
  /**
   * Every source header that is NOT a canonical import field and NOT the
   * `variantOf` column — i.e. the OPTION AXIS columns (Capacity, Color, …), in
   * sheet order. This is what the caller derives from the full header list.
   */
  optionHeaders: string[];
}

/* ------------------------------------------------------------------ */
/* Field-level errors (mirrors import.ts CellError, but by column key) */
/* ------------------------------------------------------------------ */

/** A per-cell error on a variant row, keyed by the SOURCE header it applies to. */
export interface VariantCellError {
  /** The source header (canonical field header or an option header). */
  header: string;
  message: string;
}

/* ------------------------------------------------------------------ */
/* Grouped, validated output                                           */
/* ------------------------------------------------------------------ */

/** A single coerced, commit-ready variant (one sheet row). */
export interface CoercedVariant {
  /** 1-based source row number (header + 1-based data index). */
  rowNumber: number;
  sku: string;
  optionValues: OptionValues;
  price: number; // paise
  mrp: number | null; // paise
  moq: number | null;
  stockStatus: StockStatus;
  status: EntityStatus;
}

/**
 * A validated variant GROUP: the parent product (identified by `parentSku`)
 * plus its inferred axes and coerced variants. `errorsByRow` maps each source
 * row number to its per-cell errors; a group is committable only when every one
 * of its rows is error-free.
 */
export interface VariantGroup {
  /** The parent product SKU (the shared `variantOf` value; original casing). */
  parentSku: string;
  /** Product-level fields resolved from the group (first non-empty wins). */
  product: {
    name?: string;
    categoryName?: string;
    brand?: string;
    description?: string;
    tags?: string[];
    /** GST overrides applied to the parent product (non-monetary). */
    hsnCode?: string | null;
    gstRateBps?: number | null;
    taxTreatment?: "TAX_EXCLUSIVE" | "TAX_INCLUSIVE";
  };
  /** Axes inferred from the distinct option columns/values, first-seen order. */
  optionTypes: OptionTypesInput;
  /** The coerced variants (error-free rows only appear here). */
  variants: CoercedVariant[];
  /** Source row numbers that belong to this group, in sheet order. */
  rowNumbers: number[];
  /** Per-row cell errors (row number → errors). Empty ⇒ that row is clean. */
  errorsByRow: Map<number, VariantCellError[]>;
  /** True when every row in the group is error-free (⇒ committable). */
  valid: boolean;
}

export interface GroupVariantsResult {
  /**
   * The 0-based INDICES (into the input rows array) that were consumed as
   * variant rows. The caller routes every OTHER row through the existing
   * single-product validator, so the two paths never double-count a row.
   */
  variantRowIndices: Set<number>;
  /** The validated variant groups, in first-seen parent order. */
  groups: VariantGroup[];
}

/* ------------------------------------------------------------------ */
/* groupVariantRows — the pure grouping + validation entry point       */
/* ------------------------------------------------------------------ */

/**
 * Detects, groups and validates every VARIANT row in a sheet.
 *
 * @param rows        raw rows (header → string), as from parseWorkbook
 * @param ctx         the resolved column context (must carry `variantOf`)
 * @param existingSkus lowercase SKUs already in the catalog (parent create/update)
 * @param categories  known category names → id (for parent category resolution)
 *
 * Returns the set of row indices it consumed plus the validated groups. Rows
 * with an empty `variantOf` cell are left for the single-product path (their
 * indices are NOT in `variantRowIndices`).
 */
export function groupVariantRows(
  rows: Array<Record<string, string>>,
  ctx: VariantColumnContext,
  categories: Array<{ id: string; name: string }>,
): GroupVariantsResult {
  const categoryByName = new Map(
    categories.map((c) => [c.name.trim().toLowerCase(), c.name]),
  );

  // First pass — bucket variant rows by their parent SKU (case-insensitive),
  // preserving first-seen order and original casing.
  interface Bucket {
    parentSku: string;
    rows: Array<{ index: number; rowNumber: number; raw: Record<string, string> }>;
  }
  const buckets = new Map<string, Bucket>();
  const variantRowIndices = new Set<number>();

  rows.forEach((raw, index) => {
    const parentRaw = (raw[ctx.variantOf] ?? "").trim();
    if (parentRaw === "") return; // single-product row — not ours.
    variantRowIndices.add(index);
    const key = parentRaw.toLowerCase();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { parentSku: parentRaw, rows: [] };
      buckets.set(key, bucket);
    }
    bucket.rows.push({ index, rowNumber: index + 2, raw });
  });

  // Cross-group duplicate variant-SKU detection needs the whole file's variant
  // SKUs. Count them (case-insensitive) so every occurrence can be flagged.
  const variantSkuCounts = new Map<string, number>();
  for (const bucket of buckets.values()) {
    for (const r of bucket.rows) {
      const sku = readVariantSku(r.raw, ctx).trim().toLowerCase();
      if (sku) variantSkuCounts.set(sku, (variantSkuCounts.get(sku) ?? 0) + 1);
    }
  }

  const groups: VariantGroup[] = [];
  for (const bucket of buckets.values()) {
    groups.push(
      validateGroup(bucket, ctx, categoryByName, variantSkuCounts),
    );
  }

  return { variantRowIndices, groups };
}

/** Reads the variant's own SKU cell from the resolved `variantSku` header. */
function readVariantSku(
  raw: Record<string, string>,
  ctx: VariantColumnContext,
): string {
  if (ctx.variantSku) return (raw[ctx.variantSku] ?? "").trim();
  return "";
}

/* ------------------------------------------------------------------ */
/* validateGroup — one parent + its variant rows                       */
/* ------------------------------------------------------------------ */

function validateGroup(
  bucket: {
    parentSku: string;
    rows: Array<{ index: number; rowNumber: number; raw: Record<string, string> }>;
  },
  ctx: VariantColumnContext,
  categoryByName: Map<string, string>,
  variantSkuCounts: Map<string, number>,
): VariantGroup {
  const errorsByRow = new Map<number, VariantCellError[]>();
  const pushErr = (rowNumber: number, header: string, message: string) => {
    const list = errorsByRow.get(rowNumber) ?? [];
    list.push({ header, message });
    errorsByRow.set(rowNumber, list);
  };

  const firstRow = bucket.rows[0]!;

  /* ---- parent product-level fields (first non-empty across the group) ---- */
  const pick = (header?: string): { value: string; rowNumber: number } | null => {
    if (!header) return null;
    for (const r of bucket.rows) {
      const v = (r.raw[header] ?? "").trim();
      if (v !== "") return { value: v, rowNumber: r.rowNumber };
    }
    return null;
  };

  const product: VariantGroup["product"] = {};

  const namePick = pick(ctx.name);
  if (!namePick) {
    // Name is required to CREATE a parent; whether the parent exists is decided
    // at commit time. Flag on the first row so the grid shows it.
    pushErr(firstRow.rowNumber, ctx.name ?? ctx.variantOf, "Product name is required (on the first variant row).");
  } else if (namePick.value.length < 2) {
    pushErr(namePick.rowNumber, ctx.name!, "Name is too short (min 2).");
  } else if (namePick.value.length > 160) {
    pushErr(namePick.rowNumber, ctx.name!, "Name is too long (max 160).");
  } else {
    product.name = namePick.value;
  }

  const catPick = pick(ctx.category);
  if (catPick) {
    const match = categoryByName.get(catPick.value.toLowerCase());
    if (!match) {
      pushErr(catPick.rowNumber, ctx.category!, `Unknown category "${catPick.value}".`);
    } else {
      product.categoryName = match;
    }
  } else {
    pushErr(firstRow.rowNumber, ctx.category ?? ctx.variantOf, "Category is required (on the first variant row).");
  }

  const brandPick = pick(ctx.brand);
  if (brandPick) {
    if (brandPick.value.length > 80) {
      pushErr(brandPick.rowNumber, ctx.brand!, "Brand is too long (max 80).");
    } else {
      product.brand = brandPick.value;
    }
  }

  const descPick = pick(ctx.description);
  if (descPick) {
    if (descPick.value.length > 5000) {
      pushErr(descPick.rowNumber, ctx.description!, "Description is too long (max 5000).");
    } else {
      product.description = descPick.value;
    }
  }

  const tagsPick = pick(ctx.tags);
  if (tagsPick) product.tags = parseTags(tagsPick.value);

  /* ---- GST overrides (product-level; applied to the parent) ---- */
  const hsnPick = pick(ctx.hsnCode);
  if (hsnPick) {
    if (hsnPick.value.length > 16) {
      pushErr(hsnPick.rowNumber, ctx.hsnCode!, "HSN code is too long (max 16).");
    } else {
      product.hsnCode = hsnPick.value;
    }
  }

  const gstPick = pick(ctx.gstRate);
  if (gstPick) {
    const cleaned = gstPick.value.replace(/%/g, "").replace(/,/g, "");
    const pct = Number(cleaned);
    if (!Number.isFinite(pct) || pct < 0) {
      pushErr(gstPick.rowNumber, ctx.gstRate!, `"${gstPick.value}" is not a valid GST rate.`);
    } else {
      product.gstRateBps = Math.round(pct * 100);
    }
  }

  const inclPick = pick(ctx.taxInclusive);
  if (inclPick) {
    const norm = inclPick.value.trim().toLowerCase();
    if (["true", "yes", "y", "1", "incl", "inclusive"].includes(norm)) {
      product.taxTreatment = "TAX_INCLUSIVE";
    } else if (["false", "no", "n", "0", "excl", "exclusive"].includes(norm)) {
      product.taxTreatment = "TAX_EXCLUSIVE";
    } else {
      pushErr(inclPick.rowNumber, ctx.taxInclusive!, `"${inclPick.value}" is not a valid yes/no value.`);
    }
  }

  /* ---- per-variant rows ---- */
  const variants: CoercedVariant[] = [];
  const rowNumbers = bucket.rows.map((r) => r.rowNumber);
  // Track axis → set of values (first-seen order) to infer optionTypes, and the
  // combo keys to catch duplicate combinations within this parent.
  const axisOrder: string[] = [];
  const axisValues = new Map<string, string[]>(); // canonical name → values (order)
  const seenCombos = new Map<string, number>(); // comboKey → first rowNumber

  for (const r of bucket.rows) {
    const rn = r.rowNumber;

    // --- variant option values, read from the option columns ---
    const optionValues: OptionValues = {};
    let optionsOk = true;
    for (const header of ctx.optionHeaders) {
      const raw = (r.raw[header] ?? "").trim();
      if (raw === "") {
        pushErr(rn, header, `Missing value for option "${header}".`);
        optionsOk = false;
        continue;
      }
      optionValues[header] = raw;
      // Register the axis + value (first-seen casing is canonical).
      if (!axisValues.has(header)) {
        axisValues.set(header, []);
        axisOrder.push(header);
      }
      const values = axisValues.get(header)!;
      if (!values.some((v) => v.toLowerCase() === raw.toLowerCase())) {
        values.push(raw);
      }
    }
    if (ctx.optionHeaders.length === 0) {
      pushErr(rn, ctx.variantOf, "No option columns found — a variant needs at least one option axis (e.g. Capacity).");
      optionsOk = false;
    }

    // --- variant sku ---
    const skuRaw = readVariantSku(r.raw, ctx);
    const skuHeader = ctx.variantSku ?? ctx.variantOf;
    let skuOk = false;
    if (!skuRaw) {
      pushErr(rn, skuHeader, "Variant SKU is required.");
    } else if (skuRaw.length > 64) {
      pushErr(rn, skuHeader, "SKU is too long (max 64).");
    } else if (!SKU_RE.test(skuRaw)) {
      pushErr(rn, skuHeader, "SKU may only contain letters, digits, dots, underscores and hyphens.");
    } else {
      skuOk = true;
      if ((variantSkuCounts.get(skuRaw.toLowerCase()) ?? 0) > 1) {
        pushErr(rn, skuHeader, "Duplicate variant SKU within this file.");
        skuOk = false;
      }
    }

    // --- price (required, > 0) ---
    let price: number | null = null;
    const priceRaw = ctx.price ? (r.raw[ctx.price] ?? "").trim() : "";
    if (!priceRaw) {
      pushErr(rn, ctx.price ?? ctx.variantOf, "Variant price is required.");
    } else {
      const paise = parseRupees(priceRaw);
      if (paise === null || paise <= 0) {
        pushErr(rn, ctx.price!, `"${priceRaw}" is not a valid price.`);
      } else {
        price = paise;
      }
    }

    // --- mrp (optional, ≥ price) ---
    let mrp: number | null = null;
    const mrpRaw = ctx.mrp ? (r.raw[ctx.mrp] ?? "").trim() : "";
    if (mrpRaw) {
      const paise = parseRupees(mrpRaw);
      if (paise === null || paise <= 0) {
        pushErr(rn, ctx.mrp!, `"${mrpRaw}" is not a valid MRP.`);
      } else {
        mrp = paise;
        if (price !== null && paise < price) {
          pushErr(rn, ctx.mrp!, "MRP must be greater than or equal to price.");
        }
      }
    }

    // --- moq (optional, positive int) ---
    let moq: number | null = null;
    const moqRaw = ctx.moq ? (r.raw[ctx.moq] ?? "").trim() : "";
    if (moqRaw) {
      const n = parseIntSafe(moqRaw);
      if (n === null || n <= 0) pushErr(rn, ctx.moq!, `"${moqRaw}" is not a valid MOQ.`);
      else moq = n;
    }

    // --- stock (optional enum, default IN_STOCK) ---
    let stockStatus: StockStatus = "IN_STOCK";
    const stockRaw = ctx.stock ? (r.raw[ctx.stock] ?? "").trim() : "";
    if (stockRaw) {
      const resolved = coerceStock(stockRaw);
      if (!resolved) pushErr(rn, ctx.stock!, `Unknown stock status "${stockRaw}".`);
      else stockStatus = resolved;
    }

    // --- status (optional enum, default ACTIVE) ---
    let status: EntityStatus = "ACTIVE";
    const statusRaw = ctx.status ? (r.raw[ctx.status] ?? "").trim() : "";
    if (statusRaw) {
      const resolved = coerceStatus(statusRaw);
      if (!resolved) pushErr(rn, ctx.status!, `Unknown status "${statusRaw}".`);
      else status = resolved;
    }

    // --- duplicate option combo within this parent ---
    if (optionsOk && ctx.optionHeaders.length > 0) {
      const key = comboKey(optionValues);
      const prev = seenCombos.get(key);
      if (prev !== undefined) {
        pushErr(rn, ctx.optionHeaders[0]!, "Duplicate option combination within this product.");
      } else {
        seenCombos.set(key, rn);
      }
    }

    // Only collect a fully-clean row as a committable variant.
    if (
      !errorsByRow.has(rn) &&
      skuOk &&
      optionsOk &&
      price !== null
    ) {
      variants.push({
        rowNumber: rn,
        sku: skuRaw,
        optionValues,
        price,
        mrp,
        moq,
        stockStatus,
        status,
      });
    }
  }

  const optionTypes: OptionTypesInput = axisOrder.map((name) => ({
    name,
    values: axisValues.get(name)!,
  }));

  const valid =
    errorsByRow.size === 0 && variants.length === bucket.rows.length;

  return {
    parentSku: bucket.parentSku,
    product,
    optionTypes,
    variants,
    rowNumbers,
    errorsByRow,
    valid,
  };
}

/** A stable, order-independent key for a combination of option values. */
function comboKey(values: OptionValues): string {
  return Object.keys(values)
    .sort()
    .map((k) => `${k.toLowerCase()}=${String(values[k]).toLowerCase()}`)
    .join("|");
}
