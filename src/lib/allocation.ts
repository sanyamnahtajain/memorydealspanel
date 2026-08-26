import { z } from "zod";

import { objectIdSchema } from "@/lib/schemas/shared";
import { MAX_QTY_PER_LINE } from "@/lib/schemas/cart";
import { normalisePack } from "@/lib/quantity";

/**
 * Allocation — the per-model quantity-breakdown configuration.
 *
 * A product (or its category, as an inherited default) can require buyers to
 * split a cart line's quantity across device models: "50 tempered glasses =
 * 10 × Realme 11 + 10 × S23 Ultra + 30 × iPhone 15". The models come from the
 * DeviceModel master; this module is the PURE config layer shared by server
 * and client:
 *
 *   - the persisted JSON shape + defensive parser (never throws), and
 *   - the product-over-category inheritance rule.
 *
 * `kind` is an enum with one member today so a future allocation axis (say,
 * colours) is an additive change, not a schema break.
 */

export const allocationSchema = z.object({
  kind: z.literal("DEVICE_MODEL"),
  /** When true, a cart line for this product MUST carry a breakdown. */
  required: z.boolean(),
  /** Allowed model ids; EMPTY means every ACTIVE model is allowed. */
  modelIds: z.array(objectIdSchema).max(2000).default([]),
  /**
   * OPTIONAL per-model minimum quantity ("at least 10 pcs of every model").
   * Absent on every legacy config — parsing must never change their behaviour,
   * and a corrupt stored value degrades to null (`catch`) instead of failing
   * the whole config: a bad knob must never switch a required breakdown OFF.
   * Stays OPTIONAL in the output type too, so existing builders of Allocation
   * literals (the admin editor) keep compiling untouched.
   */
  minPerModel: z
    .number()
    .int()
    .min(1)
    .max(MAX_QTY_PER_LINE)
    .nullish()
    .catch(null),
});

export type Allocation = z.infer<typeof allocationSchema>;

/** Parse a persisted JSON column into an Allocation, or null. Never throws. */
export function parseAllocation(raw: unknown): Allocation | null {
  if (raw == null) return null;
  const result = allocationSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * Resolve the effective allocation for a product:
 *   - the product's own config wins when set (INCLUDING `required: false`,
 *     which is the explicit "override the category default OFF" state);
 *   - `null` on the product inherits the category default;
 *   - no config anywhere ⇒ null (feature off — the overwhelming default).
 */
export function resolveEffectiveAllocation(
  productAllocation: unknown,
  categoryDefaultAllocation: unknown,
): Allocation | null {
  return (
    parseAllocation(productAllocation) ??
    parseAllocation(categoryDefaultAllocation)
  );
}

/**
 * The storefront-facing projection: enough for the UI to know a breakdown is
 * required and whether the model list is restricted — WITHOUT shipping a
 * potentially-huge id array to the client (the picker uses the search action,
 * which applies the restriction server-side).
 */
export interface PublicAllocation {
  kind: "DEVICE_MODEL";
  required: boolean;
  restricted: boolean;
  /** Per-model minimum quantity, when the config defines one. */
  minPerModel: number | null;
}

export function toPublicAllocation(
  allocation: Allocation | null,
): PublicAllocation | null {
  if (!allocation || !allocation.required) return null;
  return {
    kind: allocation.kind,
    required: allocation.required,
    restricted: allocation.modelIds.length > 0,
    minPerModel: allocation.minPerModel ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Per-model quantity rules (pack multiples + minimums)                */
/* ------------------------------------------------------------------ */

/**
 * The effective per-model quantity rules for one product line:
 *
 *   - `pack`: every per-model quantity must be a POSITIVE MULTIPLE of the
 *     product's packMultiple ("I can't order S23 Ultra 11 pcs at packs of
 *     10"). Falls back to 1 (no constraint) when the product has no pack.
 *   - `min`: every per-model quantity must be at least this. It is the
 *     config's `minPerModel` aligned UP onto the pack; without the knob it is
 *     simply one pack (which "a positive multiple of pack" already implies),
 *     so legacy configs behave exactly as the pack rule alone dictates.
 *
 * Pure + isomorphic — the builder uses it for instant inline feedback and the
 * cart action re-derives it server-side with identical results.
 */
export interface PerModelRules {
  pack: number;
  min: number;
}

export function perModelRules(
  minPerModel: number | null | undefined,
  packMultiple: number | null | undefined,
): PerModelRules {
  const pack = normalisePack(packMultiple);
  const knob =
    typeof minPerModel === "number" &&
    Number.isSafeInteger(minPerModel) &&
    minPerModel > 0
      ? minPerModel
      : null;
  const min = knob == null ? pack : Math.ceil(knob / pack) * pack;
  return { pack, min };
}

/**
 * The problem with ONE per-model quantity, as a short simple-English string
 * WITHOUT the model name ("Order in packs of 10") — the builder renders it
 * under the offending row, where the name is already visible. Null = fine.
 */
export function perModelIssueText(
  qty: number,
  rules: PerModelRules,
): string | null {
  if (!Number.isSafeInteger(qty) || qty <= 0) return "Enter a quantity";
  if (rules.pack > 1 && qty % rules.pack !== 0) {
    return `Order in packs of ${rules.pack}`;
  }
  if (qty < rules.min) return `Order at least ${rules.min} pcs`;
  return null;
}

export interface PerModelQty {
  /**
   * Master-list model id. ABSENT (or null) on a CUSTOM line — a model the
   * buyer typed because it was missing from the master list; such a line
   * carries only its `name`. The quantity rules apply to both identically.
   */
  modelId?: string | null;
  qty: number;
  /** Model name, when known — used to label the message. */
  name?: string | null;
}

export interface PerModelIssue {
  /**
   * The offending entry's key: the master model id, or (for a custom typed
   * line, which has no id) the typed name itself.
   */
  modelId: string;
  /** Named simple-English message: "S23 Ultra: order in packs of 10". */
  message: string;
}

/**
 * Validate every per-model quantity of a breakdown against the rules. Returns
 * one named issue per offending model (empty array = all good). NOTE: summing
 * to the line quantity is NOT this function's job — the cart schemas enforce
 * that — and validating an INPUT split is sufficient even when the server
 * merges it with a stored one: multiples sum to multiples, minima only grow.
 */
export function validatePerModelQuantities(
  entries: readonly PerModelQty[],
  rules: PerModelRules,
): PerModelIssue[] {
  const issues: PerModelIssue[] = [];
  for (const entry of entries) {
    const text = perModelIssueText(entry.qty, rules);
    if (!text) continue;
    const label = entry.name?.trim() || "This model";
    issues.push({
      // Custom lines have no id — the typed name is their stable key.
      modelId: entry.modelId ?? entry.name?.trim() ?? "custom",
      message: `${label}: ${text.charAt(0).toLowerCase()}${text.slice(1)}`,
    });
  }
  return issues;
}
