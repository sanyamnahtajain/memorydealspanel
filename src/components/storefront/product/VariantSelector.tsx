"use client";

import * as React from "react";
import { Check, LockKeyhole, MessageCircle } from "lucide-react";

import type { ProductOptionType } from "@/server/dto/product";
import type { PublicVariant, PricedVariant } from "@/server/dto/variant";
import type { CustomerStatus, StockStatus } from "@/lib/schemas/shared";
import { cn } from "@/lib/utils";
import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { PricePill } from "@/components/common/PricePill";
import { StatusChip, type StatusChipVariant } from "@/components/common/StatusChip";
import { RequestAccessSheet } from "@/components/storefront/RequestAccessSheet";
import { AddToCartButton } from "@/components/storefront/cart/AddToCartButton";
import { buildWhatsAppEnquiryLink } from "./whatsapp";

/**
 * Client-side variant selector for the product detail page — the variant-aware
 * terminus of the price gate.
 *
 * One custom control (chips, not a native <select>) is rendered per option
 * axis. Picking a value on every axis resolves the matching {@link
 * PublicVariant}/{@link PricedVariant}; the displayed price (gated), stock
 * badge, and enquiry CTA all follow the selection.
 *
 * PRICE-GATE SAFETY: for a gated viewer the DAL handed us `PublicVariant`s with
 * NO price fields (structurally absent). `showPrices` is the authoritative
 * verdict from `canSeePrices(viewer)`; we only ever read a variant `price` when
 * it is true AND the field is present. A gated payload literally cannot leak an
 * amount because none is in scope.
 *
 * This component is only mounted for products where `hasVariants` is true — a
 * non-variant product renders exactly as before via the page's static path.
 */

type AnyVariant = PublicVariant | PricedVariant;

const STOCK_LABEL: Record<StockStatus, string> = {
  IN_STOCK: "In stock",
  LOW: "Low stock",
  OUT_OF_STOCK: "Out of stock",
};

const STOCK_CHIP: Record<StockStatus, StatusChipVariant> = {
  IN_STOCK: "approved",
  LOW: "pending",
  OUT_OF_STOCK: "rejected",
};

export interface VariantSelectorProps {
  /** Parent product name — pre-fills the enquiry and describes the axes. */
  productName: string;
  /** Parent product id — sent (with the selected variantId) to add-to-cart. */
  productId?: string;
  /** Product-level MOQ — the add-to-cart quantity floor. */
  moq?: number | null;
  /** Axis definitions (name + allowed values), from `Product.optionTypes`. */
  optionTypes: ProductOptionType[];
  /** ACTIVE variants, gated by the DAL to the viewer's tier. */
  variants: AnyVariant[];
  /** Result of `canSeePrices(viewer)` — the authoritative gate verdict. */
  showPrices: boolean;
  /** Present when the viewer is a logged-in customer; drives gated copy. */
  status?: CustomerStatus;
  /**
   * Called whenever the selected variant changes (including the initial
   * resolution), so the parent can update the gallery / sticky bar. Optional.
   */
  onVariantChange?: (variant: AnyVariant | null) => void;
  className?: string;
}

/** Type guard: does this (gated) variant actually carry a price? */
function isPriced(variant: AnyVariant): variant is PricedVariant {
  return "price" in variant && typeof variant.price === "number";
}

/**
 * Finds the variant whose optionValues match the full selection across every
 * axis. Returns null until every axis has a chosen value with a real match.
 */
function resolveVariant(
  variants: AnyVariant[],
  optionTypes: ProductOptionType[],
  selection: Record<string, string>,
): AnyVariant | null {
  const axes = optionTypes.map((o) => o.name);
  if (axes.some((axis) => !selection[axis])) return null;
  return (
    variants.find((v) =>
      axes.every((axis) => v.optionValues[axis] === selection[axis]),
    ) ?? null
  );
}

/** Picks the default selection: the isDefault variant, else first in-stock, else first. */
function initialVariant(variants: AnyVariant[]): AnyVariant | null {
  if (variants.length === 0) return null;
  return (
    variants.find((v) => v.isDefault) ??
    variants.find((v) => v.stockStatus !== "OUT_OF_STOCK") ??
    variants[0]
  );
}

/**
 * True when at least one active variant with the given value on `axis` is
 * reachable from the current selection on the OTHER axes. Lets us disable
 * combinations that don't exist (e.g. "20000mAh" has no "Red").
 */
function isValueAvailable(
  variants: AnyVariant[],
  optionTypes: ProductOptionType[],
  axis: string,
  value: string,
  selection: Record<string, string>,
): boolean {
  const otherAxes = optionTypes.map((o) => o.name).filter((a) => a !== axis);
  return variants.some(
    (v) =>
      v.optionValues[axis] === value &&
      otherAxes.every(
        (a) => !selection[a] || v.optionValues[a] === selection[a],
      ),
  );
}

export function VariantSelector({
  productName,
  productId,
  moq,
  optionTypes,
  variants,
  showPrices,
  status,
  onVariantChange,
  className,
}: VariantSelectorProps) {
  const [requestOpen, setRequestOpen] = React.useState(false);

  const [selection, setSelection] = React.useState<Record<string, string>>(
    () => {
      const seed = initialVariant(variants);
      return seed ? { ...seed.optionValues } : {};
    },
  );

  const selected = React.useMemo(
    () => resolveVariant(variants, optionTypes, selection),
    [variants, optionTypes, selection],
  );

  // Notify the parent (gallery / sticky bar) whenever the resolution changes.
  // The callback ref is kept fresh in its own effect (never mutated during
  // render), and the notify effect fires only on an actual selection change.
  const notify = React.useRef(onVariantChange);
  React.useEffect(() => {
    notify.current = onVariantChange;
  }, [onVariantChange]);
  React.useEffect(() => {
    notify.current?.(selected);
  }, [selected]);

  function choose(axis: string, value: string) {
    setSelection((prev) => ({ ...prev, [axis]: value }));
  }

  const priced = selected && showPrices && isPriced(selected) ? selected : null;

  const enquireHref = buildWhatsAppEnquiryLink({
    productName: selected
      ? `${productName} (${optionTypes
          .map((o) => selection[o.name])
          .filter(Boolean)
          .join(" · ")})`
      : productName,
    sku: selected?.sku ?? null,
  });

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {/* One chip group per option axis. */}
      <div className="space-y-4">
        {optionTypes.map((option) => {
          const chosen = selection[option.name];
          return (
            <fieldset key={option.name} className="space-y-2">
              <legend className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {option.name}
                {chosen ? (
                  <span className="ml-2 text-foreground normal-case">
                    {chosen}
                  </span>
                ) : null}
              </legend>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={option.name}>
                {option.values.map((value) => {
                  const isSelected = chosen === value;
                  const available = isValueAvailable(
                    variants,
                    optionTypes,
                    option.name,
                    value,
                    selection,
                  );
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      disabled={!available}
                      onClick={() => choose(option.name, value)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        isSelected
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-card text-foreground hover:border-foreground/30 hover:bg-muted/60",
                        !available &&
                          "cursor-not-allowed border-dashed text-muted-foreground/60 line-through hover:border-border hover:bg-card",
                      )}
                    >
                      {isSelected ? (
                        <Check aria-hidden className="size-3.5" />
                      ) : null}
                      {value}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>

      {/* Selected-variant price + stock. Mirrors ProductPriceArea at variant scale. */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        {selected ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Wholesale price
              </p>
              <StatusChip
                variant={STOCK_CHIP[selected.stockStatus]}
                label={STOCK_LABEL[selected.stockStatus]}
              />
            </div>

            {priced ? (
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-heading text-3xl font-semibold tracking-tight text-foreground tabular-nums">
                  {formatPaise(priced.price)}
                </span>
                {priced.mrp && priced.mrp > priced.price ? (
                  <span className="text-base text-muted-foreground line-through tabular-nums">
                    {formatPaise(priced.mrp)}
                  </span>
                ) : null}
                {priced.marginPct && priced.marginPct > 0 ? (
                  <span className="rounded-full bg-success/10 px-2 py-0.5 text-sm font-semibold text-success">
                    {priced.marginPct}% off
                  </span>
                ) : null}
              </div>
            ) : (
              <GatedPrice
                status={status}
                onRequest={() => setRequestOpen(true)}
              />
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Select an option on each axis to see availability
            {showPrices ? " and price" : ""}.
          </p>
        )}
      </div>

      {/* Add to cart — approved-only, bound to the SELECTED variant. The button
          self-gates (locked CTA for anon/unapproved), and OUT_OF_STOCK or "no
          variant selected yet" disables it. Sends only { productId, variantId,
          quantity } — never a price. Rendered only when add-to-cart is wired in
          (a productId is present). */}
      {productId ? (
        <AddToCartButton
          productId={productId}
          variantId={selected?.id ?? null}
          moq={moq}
          canAdd={showPrices && selected != null}
          isCustomer={status !== undefined}
          outOfStock={
            !selected || selected.stockStatus === "OUT_OF_STOCK"
          }
        />
      ) : null}

      {/* Enquire CTA — carries the SELECTED variant's SKU + options. */}
      <Button
        size="lg"
        variant="default"
        className="h-11 w-full gap-2"
        disabled={!selected}
        render={
          <a
            href={enquireHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Enquire about ${productName} on WhatsApp`}
          />
        }
      >
        <MessageCircle aria-hidden />
        Enquire on WhatsApp
      </Button>

      <RequestAccessSheet open={requestOpen} onOpenChange={setRequestOpen} />
    </div>
  );
}

interface GatedReason {
  label: string;
  hint: string;
  variant: StatusChipVariant;
}

function resolveGatedReason(status: CustomerStatus | undefined): GatedReason | null {
  switch (status) {
    case "PENDING":
      return {
        label: "Awaiting approval",
        hint: "We'll notify you once approved — then prices unlock across the catalog.",
        variant: "pending",
      };
    case "EXPIRED":
    case "APPROVED":
      return {
        label: "Access expired",
        hint: "Your price access has lapsed. Request a renewal to keep seeing wholesale pricing.",
        variant: "expired",
      };
    case "REJECTED":
      return {
        label: "Request declined",
        hint: "Reach out if you think this is a mistake.",
        variant: "rejected",
      };
    case "BLOCKED":
      return {
        label: "Account blocked",
        hint: "Contact support for help with your account.",
        variant: "blocked",
      };
    default:
      return null;
  }
}

/**
 * The gated (locked) price affordance shown when `showPrices` is false. For a
 * logged-in customer we surface their status reason; for anon we offer the
 * request-access form. NEVER reads a price (there is none in scope).
 */
function GatedPrice({
  status,
  onRequest,
}: {
  status: CustomerStatus | undefined;
  onRequest: () => void;
}) {
  const reason = resolveGatedReason(status);

  if (reason) {
    return (
      <div className="mt-1 space-y-2">
        <div className="flex items-center gap-2">
          <PricePill variant="locked" size="lg" />
          <LockKeyhole aria-hidden className="size-4 text-muted-foreground" />
        </div>
        <StatusChip variant={reason.variant} label={reason.label} />
        <p className="text-sm text-muted-foreground">{reason.hint}</p>
      </div>
    );
  }

  return (
    <div className="mt-1 space-y-3">
      <div className="flex items-center gap-2">
        <PricePill variant="locked" size="lg" />
        <LockKeyhole aria-hidden className="size-4 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">
        Pricing is visible to approved wholesale buyers. Request access to
        unlock prices across the catalog.
      </p>
      <Button variant="outline" size="sm" className="h-9" onClick={onRequest}>
        Request access
      </Button>
    </div>
  );
}
