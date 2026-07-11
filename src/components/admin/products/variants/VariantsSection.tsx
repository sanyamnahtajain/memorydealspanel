"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2Icon, SparklesIcon } from "lucide-react";
import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { OptionTypesEditor } from "./OptionTypesEditor";
import { VariantMatrix } from "./VariantMatrix";
import { fromPrice, reconcileVariants, toDrafts } from "./variant-utils";
import type {
  EditorVariant,
  OptionType,
  VariantsActions,
} from "./types";

/**
 * VariantsSection — the opt-in variants surface inside the product editor.
 *
 * A toggle turns variants on/off for the product. When ON it reveals:
 *   • {@link OptionTypesEditor} — the option axes (Capacity, Color, …)
 *   • a "Generate variants" action — expands the axes into the full matrix,
 *     preserving any edits on combinations that still exist
 *   • {@link VariantMatrix} — the editable per-variant grid (price/sku/stock/
 *     status/default/photos) plus bulk "set price for all"
 *   • a "Save variants" action that persists via the injected {@link
 *     VariantsActions} (needs a saved product id).
 *
 * BACKWARD-COMPAT: when the toggle is OFF this renders nothing but the toggle —
 * the parent form keeps showing the normal single price/stock fields and the
 * product behaves exactly as today. The parent is told the current state via
 * `onStateChange` (hasVariants + the derived "from" price) so it can swap its
 * base-price field to a read-only "From ₹X" display.
 *
 * PRICE GATE: every price here is admin-only editor state (integer paise). This
 * component never renders anything anon-facing; the storefront reads gated DTOs.
 */

export interface VariantsSectionProps {
  /** Persisted product id — required to save variants. Absent on create. */
  productId?: string;
  /** Initial toggle state (Product.hasVariants). */
  initialHasVariants: boolean;
  /** Initial option axes (Product.optionTypes). */
  initialOptionTypes: OptionType[];
  /** Initial variant rows (the product's ProductVariant[] mapped for editing). */
  initialVariants: EditorVariant[];
  /** The parent product's base SKU — seeds auto-suggested variant SKUs. */
  baseSku: string;
  /** Server mutations, injected so this stays decoupled from the server half. */
  actions: VariantsActions;
  /**
   * Notifies the parent form whenever the toggle or derived "from" price
   * changes, so it can switch its base-price field to a read-only display.
   */
  onStateChange?: (state: { hasVariants: boolean; fromPrice: number | null }) => void;
  disabled?: boolean;
}

export function VariantsSection({
  productId,
  initialHasVariants,
  initialOptionTypes,
  initialVariants,
  baseSku,
  actions,
  onStateChange,
  disabled,
}: VariantsSectionProps) {
  const [hasVariants, setHasVariants] = React.useState(initialHasVariants);
  const [optionTypes, setOptionTypes] =
    React.useState<OptionType[]>(initialOptionTypes);
  const [variants, setVariants] =
    React.useState<EditorVariant[]>(initialVariants);
  const [saving, setSaving] = React.useState(false);

  const derivedFromPrice = React.useMemo(
    () => fromPrice(variants),
    [variants],
  );

  // Push toggle + derived "from" price up so the form can swap its price field.
  // Reported in an effect (not during render) to avoid updating the parent
  // mid-render; deps are primitives so it only fires on real changes.
  React.useEffect(() => {
    onStateChange?.({ hasVariants, fromPrice: derivedFromPrice });
  }, [hasVariants, derivedFromPrice, onStateChange]);

  const canPersist = Boolean(productId);

  const generate = () => {
    const next = reconcileVariants(optionTypes, variants, baseSku, {
      // Seed brand-new rows from an existing row's price, else leave 0 so the
      // operator is prompted to fill it in.
      price: variants[0]?.price ?? null,
      mrp: variants[0]?.mrp ?? null,
    });
    setVariants(next);
    if (next.length === 0) {
      toast.error("Add at least one option axis with values first.");
    }
  };

  const save = async () => {
    if (!productId) return;
    setSaving(true);
    try {
      const result = await actions.save({
        productId,
        hasVariants,
        optionTypes,
        variants: toDrafts(variants),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // Reconcile optimistic client state with the server's canonical rows
      // (real ids, recomputed default/sort, synced "from" price).
      setVariants(result.variants);
      setOptionTypes(result.optionTypes);
      toast.success("Variants saved");
    } catch {
      toast.error("Couldn’t save variants. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toggle */}
      <label
        htmlFor="has-variants"
        className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-input px-3 py-2.5 dark:bg-input/30"
      >
        <span className="space-y-0.5">
          <span className="block text-sm font-medium text-foreground">
            This product has variants
          </span>
          <span className="block text-xs text-muted-foreground">
            Sell one product in multiple options (capacity, colour, …), each with
            its own price, SKU and stock.
          </span>
        </span>
        <input
          id="has-variants"
          type="checkbox"
          checked={hasVariants}
          disabled={disabled}
          onChange={(e) => setHasVariants(e.target.checked)}
          className="size-4 shrink-0 accent-[var(--primary)]"
        />
      </label>

      {hasVariants ? (
        <div className="space-y-5">
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">Options</h3>
            <OptionTypesEditor
              value={optionTypes}
              onChange={setOptionTypes}
              disabled={disabled}
            />
            <div className="flex items-center gap-2 pt-1">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={generate}
              >
                <SparklesIcon aria-hidden />
                Generate variants
              </Button>
              <p className="text-xs text-muted-foreground">
                Builds a row for every combination; your edits are kept.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-foreground">Variants</h3>
              {derivedFromPrice != null ? (
                <span className="text-xs text-muted-foreground">
                  From{" "}
                  <span className="font-tabular text-foreground">
                    {formatPaise(derivedFromPrice)}
                  </span>
                </span>
              ) : null}
            </div>
            <VariantMatrix
              optionTypes={optionTypes}
              variants={variants}
              onChange={setVariants}
              disabled={disabled}
            />
          </div>

          {/* Save seam — variants persist independently of the base product form,
              and (like photos) need a saved product id. */}
          {canPersist ? (
            <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
              <Button
                type="button"
                disabled={disabled || saving || variants.length === 0}
                onClick={save}
              >
                {saving ? (
                  <Loader2Icon className="animate-spin" aria-hidden />
                ) : null}
                Save variants
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                Save the product to add variants
              </p>
              <p className="mt-1 text-xs">
                Variants attach to a saved product (they each need their own row).
                Create it now — you’ll return to the editor where you can define
                options and generate the matrix.
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
