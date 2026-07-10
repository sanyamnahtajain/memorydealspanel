"use client";

/**
 * StickyMobileBar — a mobile-only sticky action bar pinned to the bottom of
 * the product detail viewport ("See price / Enquire").
 *
 * PRICE-GATE SAFETY: this component receives an already-decided verdict
 * (`canSeePrices`) and, ONLY when that verdict is true, a `priceLabel` string
 * the server formatted from the PricedProduct. When gated, `priceLabel` is
 * `undefined` and the bar shows a "See price" button that opens the
 * RequestAccessSheet (anon / requestable) or, for a logged-in customer whose
 * access isn't live, a non-actionable status word. No raw paise ever reach the
 * client through this bar.
 *
 * It only mounts on mobile (below `md`); on larger screens the inline price
 * area + Enquire button already sit in view, so the bar is hidden via CSS
 * (`md:hidden`) and its spacer likewise.
 */

import * as React from "react";
import { LockIcon, MessageCircle } from "lucide-react";

import type { CustomerStatus } from "@/lib/schemas/shared";
import { RequestAccessSheet } from "@/components/storefront/RequestAccessSheet";
import { cn } from "@/lib/utils";

export interface StickyMobileBarProps {
  /** wa.me deep link (built server-side from CONTACT.whatsappNumber). */
  enquireHref: string;
  /** Authoritative gate verdict (canSeePrices). */
  canSeePrices: boolean;
  /**
   * Server-formatted price string (e.g. "₹499.50"). Present ONLY when
   * `canSeePrices` is true — never a raw amount, never present when gated.
   */
  priceLabel?: string;
  /** Present when the viewer is a logged-in customer; drives gated copy. */
  status?: CustomerStatus;
}

/** Short status word for a gated logged-in customer (no request form). */
function gatedStatusWord(status: CustomerStatus | undefined): string | null {
  switch (status) {
    case "PENDING":
      return "Awaiting approval";
    case "EXPIRED":
    case "APPROVED":
      return "Access expired";
    case "REJECTED":
      return "Request declined";
    case "BLOCKED":
      return "Account blocked";
    default:
      return null;
  }
}

export function StickyMobileBar({
  enquireHref,
  canSeePrices,
  priceLabel,
  status,
}: StickyMobileBarProps) {
  const [open, setOpen] = React.useState(false);
  const showPrice = canSeePrices && priceLabel !== undefined;
  const gatedWord = gatedStatusWord(status);

  return (
    <>
      {/* Spacer so the fixed bar never overlaps the last content on mobile. */}
      <div aria-hidden className="h-20 md:hidden" />

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur md:hidden">
        <div className="mx-auto flex w-full max-w-5xl items-stretch gap-3 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            {showPrice ? (
              <>
                <span className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
                  Wholesale
                </span>
                <span className="truncate font-heading text-lg font-semibold text-foreground tabular-nums">
                  {priceLabel}
                </span>
              </>
            ) : gatedWord ? (
              <>
                <span className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
                  Wholesale price
                </span>
                <span className="inline-flex items-center gap-1 truncate text-sm font-medium text-muted-foreground">
                  <LockIcon aria-hidden className="size-3.5 shrink-0" />
                  {gatedWord}
                </span>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label="See price — request access"
                className="group inline-flex items-center gap-2 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span
                  aria-hidden
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-sm font-medium text-muted-foreground"
                >
                  <LockIcon className="size-3.5" />
                  <span className="blur-[4px]">₹•,•••</span>
                </span>
                <span className="text-sm font-semibold text-primary group-hover:underline">
                  See price
                </span>
              </button>
            )}
          </div>

          <a
            href={enquireHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Enquire on WhatsApp"
            className={cn(
              "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm outline-none transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]",
            )}
          >
            <MessageCircle aria-hidden className="size-4" />
            Enquire
          </a>
        </div>
      </div>

      <RequestAccessSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
