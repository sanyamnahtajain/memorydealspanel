import type { EntityStatus, StockStatus } from "@/lib/schemas/shared";
import type { EditorVariant, OptionType, OptionValues } from "./types";
import { ensureSingleDefault, variantKey } from "./variant-utils";

/**
 * Server-side loaders that map persisted Prisma rows into the editor's shapes.
 * Kept framework-agnostic (no "use client") so the RSC editor page can call
 * them while building props for {@link VariantsSection}.
 *
 * These parse the loose `Json` columns (`Product.optionTypes`,
 * `ProductVariant.optionValues`) defensively — a malformed value degrades to an
 * empty/default rather than throwing, so a bad legacy row can never brick the
 * editor.
 */

/** The subset of a persisted ProductVariant the editor needs. */
export interface PersistedVariant {
  id: string;
  sku: string;
  optionValues: unknown;
  price: number;
  mrp: number | null;
  moq: number | null;
  stockStatus: StockStatus;
  status: EntityStatus;
  isDefault: boolean;
  sortOrder: number;
  images?: { length: number } | unknown[] | null;
}

/** Parses the embedded `Product.optionTypes` Json into typed axes. */
export function parseOptionTypes(raw: unknown): OptionType[] {
  if (!Array.isArray(raw)) return [];
  const out: OptionType[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name : "";
    const values = Array.isArray(obj.values)
      ? obj.values.filter((v): v is string => typeof v === "string")
      : [];
    if (name.trim() === "" || values.length === 0) continue;
    out.push({ name, values });
  }
  return out;
}

/** Parses a variant's `optionValues` Json into a string map. */
function parseOptionValues(raw: unknown): OptionValues {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: OptionValues = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
    else if (value != null) out[key] = String(value);
  }
  return out;
}

/** Counts attached images regardless of whether `images` is an array or null. */
function imageCount(images: PersistedVariant["images"]): number {
  return Array.isArray(images) ? images.length : 0;
}

/**
 * Maps persisted variant rows to {@link EditorVariant}s, sorted by `sortOrder`
 * then guaranteed to carry exactly one default. Safe on an empty list.
 */
export function toEditorVariants(rows: PersistedVariant[]): EditorVariant[] {
  const mapped = [...rows]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row, index): EditorVariant => {
      const optionValues = parseOptionValues(row.optionValues);
      return {
        id: row.id,
        key: variantKey(optionValues),
        optionValues,
        sku: row.sku,
        price: row.price,
        mrp: row.mrp,
        moq: row.moq,
        stockStatus: row.stockStatus,
        status: row.status,
        isDefault: row.isDefault,
        sortOrder: index,
        imageCount: imageCount(row.images),
      };
    });
  return ensureSingleDefault(mapped);
}
