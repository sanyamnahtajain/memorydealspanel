import type { EntityStatus, StockStatus } from "@/lib/schemas/shared";

/**
 * Client-side contract for the product-variants editor.
 *
 * This module owns the *shapes* the variants UI passes around. The server side
 * (validation schema, DTOs, DAL, and the `@/server/actions/variants` mutations)
 * is owned by a sibling workstream; the editor talks to it exclusively through
 * the injected {@link VariantsActions} interface, so the two halves compile and
 * evolve independently. See `variants/actions.ts` for the integration seam.
 *
 * MONEY: every amount here is integer paise (see src/lib/money.ts) — the same
 * unit the rest of the catalog stores. Rupee text only exists inside inputs and
 * is parsed to paise before it ever reaches these shapes.
 */

/**
 * One embedded option axis of a variant product, e.g.
 * `{ name: "Capacity", values: ["10000mAh", "20000mAh"] }`. Mirrors an element
 * of `Product.optionTypes` (Json) in prisma/schema.prisma.
 */
export interface OptionType {
  /** Axis label shown to the buyer, e.g. "Capacity" or "Color". */
  name: string;
  /** The distinct selectable values on this axis, in display order. */
  values: string[];
}

/**
 * The chosen value on each axis for a single variant, keyed by option name,
 * e.g. `{ Capacity: "20000mAh", Color: "Black" }`. Mirrors
 * `ProductVariant.optionValues` (Json).
 */
export type OptionValues = Record<string, string>;

/**
 * A variant row as the editor holds it. `id` is the persisted ObjectId when the
 * row already exists on the server; a freshly-generated (unsaved) row has an
 * `id` of `null` and is keyed off {@link EditorVariant.key} instead.
 */
export interface EditorVariant {
  /** Persisted ProductVariant id, or null for a not-yet-saved row. */
  id: string | null;
  /** Stable client key (option-values signature) — survives re-generation. */
  key: string;
  optionValues: OptionValues;
  sku: string;
  /** Selling price, integer paise. */
  price: number;
  /** MRP, integer paise, when set. */
  mrp: number | null;
  moq: number | null;
  stockStatus: StockStatus;
  status: EntityStatus;
  /** Exactly one variant is the default (the pre-selected combination). */
  isDefault: boolean;
  sortOrder: number;
  /** Count of images attached to this variant (managed on a per-variant page). */
  imageCount: number;
}

/**
 * The variant fields a save sends to the server. Mirrors the writable columns
 * of ProductVariant; `id` present => update that row, absent/null => create.
 */
export interface VariantDraft {
  id: string | null;
  optionValues: OptionValues;
  sku: string;
  price: number;
  mrp: number | null;
  moq: number | null;
  stockStatus: StockStatus;
  status: EntityStatus;
  isDefault: boolean;
  sortOrder: number;
}

/** Payload persisted by {@link VariantsActions.save}. */
export interface SaveVariantsInput {
  productId: string;
  hasVariants: boolean;
  optionTypes: OptionType[];
  variants: VariantDraft[];
}

/**
 * The typed result of a variants mutation. On success the server echoes the
 * canonical rows back (with real ids + the recomputed "from" price) so the
 * editor can reconcile optimistic client state.
 */
export type VariantsActionResult =
  | { ok: true; variants: EditorVariant[]; optionTypes: OptionType[]; fromPrice: number | null }
  | { ok: false; error: string };

/**
 * The mutation surface the editor depends on. Injected into
 * {@link VariantsSection} so the client bundle never hard-links a server module
 * that a parallel workstream owns. The editor page wires the real
 * implementation (see `variants/actions.ts`).
 */
export interface VariantsActions {
  /** Persist the toggle + option axes + full variant set for a product. */
  save(input: SaveVariantsInput): Promise<VariantsActionResult>;
}
