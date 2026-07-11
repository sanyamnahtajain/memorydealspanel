import type {
  EditorVariant,
  OptionType,
  OptionValues,
  VariantDraft,
} from "./types";

/**
 * Pure, side-effect-free helpers for the variants editor: generating the
 * combination matrix from the option axes, suggesting SKUs, deriving the
 * denormalized "from" price, and paise <-> rupee-string conversion.
 *
 * These are unit-tested (variant-utils.test.ts) because they encode the two
 * load-bearing invariants of Phase 11:
 *   1. the generated matrix is the exact cartesian product of the axes, and
 *   2. the product's "from" price = min ACTIVE variant price (keeps listing
 *      sort correct while each variant carries its own gated price).
 */

/** A stable, order-independent signature of an option-values map. */
export function variantKey(optionValues: OptionValues): string {
  return Object.keys(optionValues)
    .sort()
    .map((name) => `${name}=${optionValues[name]}`)
    .join("|");
}

/**
 * Cartesian product of the option axes -> one `OptionValues` per combination.
 * Empty axes (no name or no values) are skipped. With no usable axes the result
 * is empty (a variant product needs at least one axis with values).
 *
 * Order is stable: axes in declared order, values in declared order, so the
 * generated matrix is deterministic and diffable across regenerations.
 */
export function cartesian(optionTypes: OptionType[]): OptionValues[] {
  const axes = optionTypes
    .map((axis) => ({
      name: axis.name.trim(),
      values: dedupe(axis.values.map((v) => v.trim()).filter(Boolean)),
    }))
    .filter((axis) => axis.name !== "" && axis.values.length > 0);

  if (axes.length === 0) return [];

  let combos: OptionValues[] = [{}];
  for (const axis of axes) {
    const next: OptionValues[] = [];
    for (const combo of combos) {
      for (const value of axis.values) {
        next.push({ ...combo, [axis.name]: value });
      }
    }
    combos = next;
  }
  return combos;
}

/** Case-insensitive de-dupe preserving first-seen order. */
function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const k = value.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(value);
  }
  return out;
}

/** Uppercased, dash-safe token from an option value ("20000mAh" -> "20000MAH"). */
function skuToken(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Suggests a variant SKU from the parent SKU and the combination, e.g.
 * base "PB-ANK" + { Capacity: "20000mAh", Color: "Black" } -> "PB-ANK-20000MAH-BLACK".
 * Deterministic and editable — the operator can always override.
 */
export function suggestSku(baseSku: string, optionValues: OptionValues): string {
  const base = skuToken(baseSku) || "SKU";
  const suffix = Object.keys(optionValues)
    .map((name) => skuToken(optionValues[name]))
    .filter(Boolean)
    .join("-");
  return suffix ? `${base}-${suffix}` : base;
}

/**
 * The denormalized "FROM" price kept on Product.price for variant products:
 * the minimum price across ACTIVE variants (paise). Returns null when no active
 * variant has a price yet, so the editor can prompt instead of showing ₹0.
 *
 * INVARIANT: listing/sort read Product.price, so this MUST equal the cheapest
 * price a buyer could actually be quoted — hence ACTIVE-only.
 */
export function fromPrice(variants: Pick<EditorVariant, "price" | "status">[]): number | null {
  let min: number | null = null;
  for (const variant of variants) {
    if (variant.status !== "ACTIVE") continue;
    if (!Number.isFinite(variant.price) || variant.price <= 0) continue;
    if (min === null || variant.price < min) min = variant.price;
  }
  return min;
}

/**
 * Reconciles a freshly-generated combination matrix against the current editor
 * rows: existing rows (matched by option-values signature) keep their edited
 * price/sku/stock/etc.; brand-new combinations get a suggested SKU and inherit
 * the given base price/mrp as sensible starting points. Combinations that no
 * longer exist (an axis value was removed) are dropped.
 *
 * Exactly one row is guaranteed to be `isDefault` afterwards: the previously
 * default row if it survived, else the first row.
 */
export function reconcileVariants(
  optionTypes: OptionType[],
  existing: EditorVariant[],
  baseSku: string,
  seed: { price: number | null; mrp: number | null },
): EditorVariant[] {
  const byKey = new Map(existing.map((variant) => [variant.key, variant]));
  const combos = cartesian(optionTypes);

  const rows = combos.map((optionValues, index): EditorVariant => {
    const key = variantKey(optionValues);
    const prior = byKey.get(key);
    if (prior) {
      // Preserve operator edits; only resync the derived sort order.
      return { ...prior, optionValues, sortOrder: index };
    }
    return {
      id: null,
      key,
      optionValues,
      sku: suggestSku(baseSku, optionValues),
      price: seed.price ?? 0,
      mrp: seed.mrp,
      moq: null,
      stockStatus: "IN_STOCK",
      status: "ACTIVE",
      isDefault: false,
      sortOrder: index,
      imageCount: 0,
    };
  });

  return ensureSingleDefault(rows, existing);
}

/**
 * Guarantees exactly one default among `rows`. Prefers a row that is already
 * flagged default; otherwise carries over the previously-default combination if
 * it survived; otherwise falls back to the first row.
 */
export function ensureSingleDefault(
  rows: EditorVariant[],
  previous: EditorVariant[] = [],
): EditorVariant[] {
  if (rows.length === 0) return rows;

  const priorDefaultKey =
    rows.find((row) => row.isDefault)?.key ??
    previous.find((row) => row.isDefault)?.key ??
    rows[0].key;

  return rows.map((row) => ({ ...row, isDefault: row.key === priorDefaultKey }));
}

/** Flips the default flag to `key`, clearing it everywhere else. */
export function setDefault(rows: EditorVariant[], key: string): EditorVariant[] {
  if (!rows.some((row) => row.key === key)) return rows;
  return rows.map((row) => ({ ...row, isDefault: row.key === key }));
}

/** Human label for a combination, e.g. "20000mAh · Black". */
export function variantLabel(optionValues: OptionValues): string {
  const parts = Object.keys(optionValues).map((name) => optionValues[name]);
  return parts.length > 0 ? parts.join(" · ") : "Default";
}

/** Projects editor rows to the server draft shape (drops UI-only fields). */
export function toDrafts(rows: EditorVariant[]): VariantDraft[] {
  return rows.map((row, index) => ({
    id: row.id,
    optionValues: row.optionValues,
    sku: row.sku.trim(),
    price: row.price,
    mrp: row.mrp,
    moq: row.moq,
    stockStatus: row.stockStatus,
    status: row.status,
    isDefault: row.isDefault,
    sortOrder: index,
  }));
}
