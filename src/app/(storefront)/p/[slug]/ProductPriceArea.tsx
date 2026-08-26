"use client";

import * as React from "react";
import { LockKeyhole } from "lucide-react";

import type { PublicProduct, PricedProduct } from "@/server/dto/product";
import type { CustomerStatus } from "@/lib/schemas/shared";
import type { GstView } from "@/server/prefs/gst-view";
import { accessCopy, resolveAccessState } from "@/lib/access-status";
import { PricePill, formatPaise } from "@/components/common";
import { StatusChip } from "@/components/common/StatusChip";
import { Button } from "@/components/ui/button";
import { RequestAccessSheet } from "@/components/storefront/RequestAccessSheet";
import {
  GatedRenewCta,
  ACCESS_CHIP_VARIANT,
} from "@/components/storefront/GatedRenewCta";

/**
 * Price area for the product detail page — the detail-styled render-side
 * terminus of the price gate.
 *
 * This mirrors {@link PriceGateCard}'s contract at a larger, page-hero scale:
 *   - a price-authorised viewer holding a PricedProduct sees the real price;
 *   - an anon viewer (or a customer who may still request) sees a locked
 *     placeholder whose CTA opens the {@link RequestAccessSheet} inline;
 *   - a logged-in customer whose access isn't live sees the canonical access
 *     status (src/lib/access-status.ts) — and, for expired/rejected, a
 *     one-tap renewal CTA (GatedRenewCta) instead of the anon request form.
 *
 * PRICE-GATE SAFETY: when `showPrices` is false the DAL handed us a
 * `PublicProduct` with NO price fields (structurally absent), so nothing here
 * can leak. We `in`-check the field as belt-and-braces and never read a price
 * unless `showPrices` is true.
 */
export interface ProductPriceAreaProps {
  /** Google-only storefront: gate the request-access sheet. */
  googleGateHref?: string | null;
  product: PublicProduct | PricedProduct;
  /** Result of `canSeePrices(viewer)` — the authoritative gate verdict. */
  showPrices: boolean;
  /** Present when the viewer is a logged-in customer; drives the gated copy. */
  status?: CustomerStatus;
  /**
   * The retailer's incl/excl display preference (from `getGstViewPreference()`).
   * Only affects the wording of the tax line, never the figure. Ignored while
   * GST is off (the line renders nothing then).
   */
  gstView?: GstView;
}

/** Formats basis points as a trimmed percentage: 1800 → "18", 1250 → "12.5". */
function formatRate(bps: number): string {
  const pct = bps / 100;
  return Number.isInteger(pct) ? String(pct) : String(Number(pct.toFixed(2)));
}

/**
 * The clear tax-treatment line beneath the detail price.
 *
 * PRICE-GATE SAFETY: `tax` ({@link PublicProduct.tax}) is NON-MONETARY and drives
 * the "incl./+ X% GST" label for EVERY viewer. `taxPaise` is the paise amount
 * from a Priced DTO — only ever passed for an approved viewer — and adds the
 * "(incl. ₹X GST)" figure. When GST is off (`gstRateBps` null/zero) this renders
 * nothing, exactly as the pre-GST detail page.
 */
function TaxTreatmentLine({
  gstRateBps,
  taxInclusive,
  taxPaise,
  view,
}: {
  gstRateBps: number | null;
  taxInclusive: boolean;
  /** Priced-only GST amount in paise; omit for a gated viewer. */
  taxPaise?: number | null;
  view?: GstView;
}) {
  if (gstRateBps === null || gstRateBps <= 0) return null;

  const ratePct = formatRate(gstRateBps);
  // The displayed price is inclusive when the effective treatment is inclusive;
  // the retailer's view preference flips only the wording, not the figure.
  const preferInclusive = view === undefined ? taxInclusive : view === "incl";
  const label = preferInclusive
    ? `Price incl. ${ratePct}% GST`
    : `+ ${ratePct}% GST`;

  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {label}
      {typeof taxPaise === "number" && taxPaise > 0 ? (
        <span className="text-muted-foreground/80">
          {" "}
          ({taxInclusive ? "incl." : "+"} {formatPaise(taxPaise)} GST)
        </span>
      ) : null}
    </p>
  );
}

function hasPrice(
  product: PublicProduct | PricedProduct,
): product is PricedProduct {
  return "price" in product && typeof product.price === "number";
}

export function ProductPriceArea({
  googleGateHref = null,
  product,
  showPrices,
  status,
  gstView,
}: ProductPriceAreaProps) {
  const [open, setOpen] = React.useState(false);
  // NON-MONETARY GST metadata — present on every viewer's DTO, carries no paise.
  const tax = product.tax;

  // NOTE: this component renders the price panel's INNER content only — the
  // page (or VariantSelector) supplies the elevated card around it.
  if (showPrices && hasPrice(product)) {
    const priced = product;
    return (
      <div>
        <p className="text-[0.7rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">
          Wholesale price
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-heading text-[2rem] font-semibold tracking-tight text-foreground tabular-nums sm:text-4xl">
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
        {/* Clear GST treatment line. For an approved viewer we also surface the
            paise amount from the priced taxBreakdown. Renders nothing when GST
            is off. */}
        {tax.gstRateBps !== null && tax.gstRateBps > 0 ? (
          <TaxTreatmentLine
            gstRateBps={tax.gstRateBps}
            taxInclusive={tax.taxInclusive}
            taxPaise={priced.taxBreakdown?.taxPaise ?? null}
            view={gstView}
          />
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            Inclusive of applicable taxes.
          </p>
        )}
      </div>
    );
  }

  // Canonical access state (src/lib/access-status.ts). `priceAccess: false`:
  // we only reach here when the gate is closed, so a status of APPROVED means
  // the grant lapsed and resolves to "expired" — expired = status EXPIRED or
  // (APPROVED && !showPrices).
  const state = resolveAccessState({
    signedIn: status !== undefined,
    status,
    priceAccess: false,
  });

  // Gated + logged-in customer: the canonical status plus (for expired/
  // rejected) the ONE action — a renewal request — not the anon request form.
  if (state !== "anon") {
    const copy = accessCopy(state);
    return (
      <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-[0.7rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              Wholesale price
            </p>
            <PricePill variant="locked" size="lg" />
          </div>
          <LockKeyhole
            aria-hidden
            className="mt-1 size-5 shrink-0 text-muted-foreground"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusChip variant={ACCESS_CHIP_VARIANT[state]} label={copy.chip} />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{copy.body}</p>
        {state === "expired" || state === "rejected" ? (
          <GatedRenewCta state={state} size="sm" className="mt-3 h-9" />
        ) : null}
        {/* Label only — never a paise amount for a gated viewer. */}
        <TaxTreatmentLine
          gstRateBps={tax.gstRateBps}
          taxInclusive={tax.taxInclusive}
          view={gstView}
        />
      </div>
    );
  }

  // Anon (or a viewer who can still request) → open the request sheet inline.
  return (
    <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[0.7rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">
            Wholesale price
          </p>
          <PricePill variant="locked" size="lg" />
        </div>
        <LockKeyhole
          aria-hidden
          className="mt-1 size-5 shrink-0 text-muted-foreground"
        />
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Pricing is visible to approved wholesale buyers. Request access to
        unlock prices across the catalog.
      </p>
      <Button
        variant="default"
        size="sm"
        className="mt-3 h-10 px-5 transition-transform active:scale-[0.98]"
        onClick={() => setOpen(true)}
      >
        Request access
      </Button>
      {/* Label only — a gated viewer sees the GST treatment, never an amount. */}
      <TaxTreatmentLine
        gstRateBps={tax.gstRateBps}
        taxInclusive={tax.taxInclusive}
        view={gstView}
      />
      <RequestAccessSheet open={open} onOpenChange={setOpen} googleGateHref={googleGateHref} />
    </div>
  );
}
