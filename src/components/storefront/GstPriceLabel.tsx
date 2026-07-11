/**
 * GstPriceLabel — the tax-aware caption that sits under a storefront price.
 *
 * It renders a small "incl. 18% GST" / "+ 18% GST" hint derived from the
 * product/variant GST metadata. It is deliberately a PURE, server-renderable
 * component (no "use client", no hooks) so it can be dropped straight into the
 * server-built price slot.
 *
 * PRICE-GATE SAFETY — two strictly separated inputs:
 *
 *  - `tax` ({@link PublicTaxMeta}) is NON-MONETARY (HSN / rate bps / inclusive
 *    flag). It is present on EVERY viewer's DTO, gated or not, and carries NO
 *    paise. The rate-only hint ("+ 18% GST") is built solely from this.
 *  - `breakdown` ({@link PricedTaxBreakdown}) carries the paise tax amount and
 *    exists ONLY on a PricedProduct/PricedVariant. It is optional here; when it
 *    is absent (a gated viewer, who never receives it) NO amount is rendered.
 *
 * So a gated viewer can only ever produce the amount-free rate hint, and only
 * an approved viewer who was handed a `breakdown` can see the "incl. ₹X GST"
 * subline. When GST is off the metadata's `gstRateBps` is null and the whole
 * component renders nothing (returns null) — exactly the pre-GST storefront.
 */

import { formatPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { PublicTaxMeta, PricedTaxBreakdown } from "@/server/dto/product";
import type { GstView } from "@/server/prefs/gst-view";

const SIZE_CLASSES = {
  sm: "text-[0.65rem]",
  md: "text-xs",
  lg: "text-sm",
} as const;

export type GstLabelSize = keyof typeof SIZE_CLASSES;

export interface GstPriceLabelProps {
  /** NON-MONETARY GST metadata (safe for every viewer). Drives the rate hint. */
  tax: PublicTaxMeta;
  /**
   * The paise GST breakdown of the displayed price. Present ONLY for an
   * approved viewer (from a Priced DTO); omit / null for a gated viewer so no
   * amount is ever rendered.
   */
  breakdown?: PricedTaxBreakdown | null;
  /**
   * The retailer's incl/excl display preference. Only affects the wording of
   * the label; the underlying figure is unchanged. Defaults to matching the
   * effective treatment.
   */
  view?: GstView;
  size?: GstLabelSize;
  className?: string;
}

/** Formats basis points as a trimmed percentage: 1800 → "18", 1250 → "12.5". */
function formatRate(bps: number): string {
  const pct = bps / 100;
  return Number.isInteger(pct) ? String(pct) : String(Number(pct.toFixed(2)));
}

/**
 * Renders the GST caption, or `null` when there is nothing to show (GST off, or
 * a zero / missing rate). Never reads a paise amount unless a `breakdown` was
 * explicitly supplied.
 */
export function GstPriceLabel({
  tax,
  breakdown,
  view,
  size = "sm",
  className,
}: GstPriceLabelProps) {
  // GST off (or no effective rate) ⇒ render exactly as the pre-GST storefront.
  if (tax.gstRateBps === null || tax.gstRateBps <= 0) return null;

  const ratePct = formatRate(tax.gstRateBps);
  // Wording: the displayed price is inclusive when the effective treatment is
  // inclusive; the retailer's view preference can flip the caption to read the
  // other way for the same figure ("shown incl., you asked to see excl.").
  const shownInclusive = tax.taxInclusive;
  const preferInclusive = view === undefined ? shownInclusive : view === "incl";
  const label = preferInclusive
    ? `incl. ${ratePct}% GST`
    : `+ ${ratePct}% GST`;

  return (
    <span
      data-slot="gst-label"
      className={cn(
        "inline-flex items-baseline gap-1 font-medium text-muted-foreground",
        SIZE_CLASSES[size],
        className,
      )}
    >
      <span>{label}</span>
      {breakdown && breakdown.taxPaise > 0 ? (
        // The paise subline — only ever rendered from an explicitly-supplied
        // priced breakdown, i.e. for an approved viewer.
        <span className="text-muted-foreground/80">
          ({shownInclusive ? "incl." : "+"} {formatPaise(breakdown.taxPaise)})
        </span>
      ) : null}
    </span>
  );
}
