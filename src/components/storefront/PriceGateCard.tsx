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
 * replaced by a status message ("Awaiting approval" / "Access expired") rather
 * than the request form, since re-requesting is not what they need.
 */

import * as React from "react";
import { LockIcon } from "lucide-react";

import type { PublicProduct, PricedProduct } from "@/server/dto/product";
import type { CustomerStatus } from "@/lib/schemas/shared";
import { StatusChip } from "@/components/common/StatusChip";
import { ScaleTap } from "@/components/motion/primitives";
import { cn } from "@/lib/utils";
import "@/components/common/shimmer.css";

import { PriceReveal } from "./PriceReveal";
import { RequestAccessSheet } from "./RequestAccessSheet";

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
  className?: string;
}

/**
 * The gate itself. `canSeePrices` is authoritative — even if a caller somehow
 * passed a priced product, we do not reveal it unless the gate is open.
 */
export function PriceGateCard({
  product,
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

  // Gated: a logged-in customer awaiting/without live access sees a reason,
  // not the request form (they've already requested).
  const gatedReason = resolveGatedReason(status);

  if (gatedReason) {
    return (
      <div
        data-slot="price-gate"
        data-state="pending-status"
        className={cn("flex flex-col items-start gap-1.5", className)}
      >
        <LockedChip size={size} label={gatedReason.chipLabel} />
        <div className="flex items-center gap-1.5">
          <StatusChip variant={gatedReason.variant} label={gatedReason.status} />
          <span className="text-xs text-muted-foreground">
            {gatedReason.hint}
          </span>
        </div>
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
      <RequestAccessSheet open={open} onOpenChange={setOpen} />
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

/* ------------------------------------------------------------------ */
/* Gated-status copy                                                  */
/* ------------------------------------------------------------------ */

interface GatedReason {
  chipLabel: string;
  status: string;
  hint: string;
  variant: "pending" | "expired" | "rejected" | "blocked";
}

/**
 * Maps a logged-in customer's status to gate copy. Returns null for statuses
 * where the request form is the right call (anon has no status; APPROVED-but-
 * ungranted is treated like expired so the customer knows to seek renewal).
 */
function resolveGatedReason(
  status: CustomerStatus | undefined,
): GatedReason | null {
  switch (status) {
    case "PENDING":
      return {
        chipLabel: "Price hidden — awaiting approval",
        status: "Awaiting approval",
        hint: "We'll notify you once approved.",
        variant: "pending",
      };
    case "EXPIRED":
    case "APPROVED": // approved status but gate closed ⇒ grant lapsed
      return {
        chipLabel: "Price hidden — access expired",
        status: "Access expired",
        hint: "Contact us to renew access.",
        variant: "expired",
      };
    case "REJECTED":
      return {
        chipLabel: "Price hidden — request declined",
        status: "Request declined",
        hint: "Reach out if you think this is a mistake.",
        variant: "rejected",
      };
    case "BLOCKED":
      return {
        chipLabel: "Price hidden",
        status: "Account blocked",
        hint: "Contact support for help.",
        variant: "blocked",
      };
    default:
      // Anon / unknown → the request form is the right affordance.
      return null;
  }
}
