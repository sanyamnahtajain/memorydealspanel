"use client";

/**
 * PriceGateCard — the signature price-gate control of the storefront.
 *
 * It renders exactly ONE of two things:
 *   - the real price (PriceReveal) — ONLY when `canSeePrices` is true AND the
 *     product actually carries a price (i.e. the server handed us a
 *     PricedProduct);
 *   - a shimmering LOCKED chip with a "See price" affordance otherwise.
 *
 * PRICE-GATE SAFETY: when `canSeePrices` is false the server passes a
 * PublicProduct that structurally has no `price`/`mrp` fields, and this
 * component NEVER reads them. It also never fetches prices client-side. So an
 * anon / pending / expired viewer cannot obtain a price through this card.
 *
 * For a logged-in customer whose access isn't live, the locked affordance is
 * replaced by the canonical access status (src/lib/access-status.ts) plus —
 * for expired/rejected — a one-tap renewal CTA (GatedRenewCta), never the
 * anon request form and never a dead "contact us".
 */

import * as React from "react";
import { LockIcon } from "lucide-react";

import type { PublicProduct, PricedProduct } from "@/server/dto/product";
import type { CustomerStatus } from "@/lib/schemas/shared";
import { accessCopy, resolveAccessState } from "@/lib/access-status";
import { StatusChip } from "@/components/common/StatusChip";
import { ScaleTap } from "@/components/motion/primitives";
import { cn } from "@/lib/utils";
import "@/components/common/shimmer.css";

import { PriceReveal } from "./PriceReveal";
import { RequestAccessSheet } from "./RequestAccessSheet";
import { GatedRenewCta, ACCESS_CHIP_VARIANT } from "./GatedRenewCta";

/** Narrows a product DTO to its priced form without trusting a leaked field. */
function hasPrice(
  product: PublicProduct | PricedProduct,
): product is PricedProduct {
  return (
    "price" in product && typeof (product as PricedProduct).price === "number"
  );
}

type GateSize = "sm" | "md" | "lg";

const CHIP_SIZE: Record<GateSize, string> = {
  sm: "h-6 gap-1 px-2 text-xs [&_svg]:size-3",
  md: "h-7 gap-1.5 px-2.5 text-sm [&_svg]:size-3.5",
  lg: "h-9 gap-1.5 px-3.5 text-base [&_svg]:size-4",
};

export interface PriceGateCardProps {
  product: PublicProduct | PricedProduct;
  /** The single price-gate predicate result, computed server-side. */
  canSeePrices: boolean;
  /** Present when the viewer is a logged-in customer; drives the gated copy. */
  status?: CustomerStatus;
  size?: GateSize;
  /** Animate the reveal (default true). Pass false inside dense lists. */
  animate?: boolean;
  /** Google-only gate: when set, "Request access" routes to Google. */
  googleGateHref?: string | null;
  className?: string;
}

/**
 * The gate itself. `canSeePrices` is authoritative — even if a caller somehow
 * passed a priced product, we do not reveal it unless the gate is open.
 */
export function PriceGateCard({
  product,
  googleGateHref = null,
  canSeePrices,
  status,
  size = "md",
  animate = true,
  className,
}: PriceGateCardProps) {
  const [open, setOpen] = React.useState(false);

  if (canSeePrices && hasPrice(product)) {
    return (
      <PriceReveal
        paise={product.price}
        mrp={product.mrp}
        marginPct={product.marginPct}
        size={size}
        animate={animate}
        className={className}
      />
    );
  }

  // Gated: a logged-in customer awaiting/without live access sees the ONE
  // canonical status (src/lib/access-status.ts) — and, when lapsed/declined,
  // the ONE action (renewal) instead of the request form. `priceAccess: false`
  // because we only reach here when the gate is closed; an APPROVED status
  // therefore resolves to "expired" (grant lapsed).
  const state = resolveAccessState({
    signedIn: status !== undefined,
    status,
    priceAccess: false,
  });

  if (state !== "anon") {
    const copy = accessCopy(state);
    return (
      <div
        data-slot="price-gate"
        data-state="pending-status"
        className={cn("flex flex-col items-start gap-1.5", className)}
      >
        <LockedChip size={size} label={`Price hidden — ${copy.chip}`} />
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusChip variant={ACCESS_CHIP_VARIANT[state]} label={copy.chip} />
          <span className="text-xs text-muted-foreground">{copy.body}</span>
        </div>
        {state === "expired" || state === "rejected" ? (
          <GatedRenewCta state={state} size="sm" className="mt-0.5" />
        ) : null}
      </div>
    );
  }

  // Anon or a viewer who can still request access → open the request sheet.
  return (
    <div
      data-slot="price-gate"
      data-state="locked"
      className={cn("flex flex-col items-start gap-1.5", className)}
    >
      <ScaleTap className="w-fit">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group flex items-center gap-2 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label="See price — request access"
        >
          <LockedChip size={size} />
          <span className="text-sm font-medium text-primary group-hover:underline">
            See price
          </span>
        </button>
      </ScaleTap>
      <RequestAccessSheet open={open} onOpenChange={setOpen} googleGateHref={googleGateHref} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Locked chip (self-contained; mirrors PricePill's locked variant)   */
/* ------------------------------------------------------------------ */

function LockedChip({
  size = "md",
  label,
}: {
  size?: GateSize;
  label?: string;
}) {
  return (
    <span
      data-slot="price-pill"
      data-variant="locked"
      role="img"
      aria-label={label ?? "Price hidden — approval required"}
      className={cn(
        "md-shimmer inline-flex w-fit shrink-0 items-center rounded-full border border-border font-tabular font-medium text-muted-foreground select-none",
        CHIP_SIZE[size],
      )}
    >
      <LockIcon aria-hidden className="shrink-0" />
      <span aria-hidden className="blur-[5px]">
        {"₹"}
        {"•,•••"}
      </span>
    </span>
  );
}
