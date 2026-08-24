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
 * access isn't live, the canonical status word (src/lib/access-status.ts) —
 * tappable for expired customers, opening the renewal dialog. No raw paise
 * ever reach the client through this bar.
 *
 * It only mounts on mobile (below `md`); on larger screens the inline price
 * area + Enquire button already sit in view, so the bar is hidden via CSS
 * (`md:hidden`) and its spacer likewise.
 */

import * as React from "react";
import { LockIcon, MessageCircle } from "lucide-react";

import type { CustomerStatus } from "@/lib/schemas/shared";
import { accessCopy, resolveAccessState } from "@/lib/access-status";
import { RequestAccessSheet } from "@/components/storefront/RequestAccessSheet";
import { GatedRenewCta } from "@/components/storefront/GatedRenewCta";
import { cn } from "@/lib/utils";

export interface StickyMobileBarProps {
  /**
   * wa.me deep link minted server-side per viewer — `null` when the WhatsApp
   * gate is closed, in which case the Enquire slot becomes a locked affordance
   * (request access for anon; a status word for a gated customer).
   */
  enquireHref: string | null;
  /** Authoritative gate verdict (canSeePrices). */
  canSeePrices: boolean;
  /**
   * Server-formatted price string (e.g. "₹499.50"). Present ONLY when
   * `canSeePrices` is true — never a raw amount, never present when gated.
   */
  priceLabel?: string;
  /** Present when the viewer is a logged-in customer; drives gated copy. */
  status?: CustomerStatus;
  /** Google-only gate: when set, "Request access" routes to Google. */
  googleGateHref?: string | null;
}

export function StickyMobileBar({
  enquireHref,
  canSeePrices,
  priceLabel,
  status,
  googleGateHref = null,
}: StickyMobileBarProps) {
  const [open, setOpen] = React.useState(false);
  const showPrice = canSeePrices && priceLabel !== undefined;
  // Canonical access state (src/lib/access-status.ts); the status slot only
  // renders when the gate is closed, so APPROVED resolves to "expired".
  const state = resolveAccessState({
    signedIn: status !== undefined,
    status,
    priceAccess: false,
  });
  const gatedWord = state !== "anon" ? accessCopy(state).chip : null;

  return (
    <>
      {/* Spacer so the fixed bar never overlaps the last content on mobile.
          The bar is lifted above the storefront tab nav, so this clears the
          bar height + that offset. */}
      <div aria-hidden className="h-[calc(8rem+env(safe-area-inset-bottom))] md:hidden" />

      {/* Sits ABOVE the storefront bottom tab nav (fixed bottom-0 z-40 md:hidden,
          ~3.5rem tall); this bar is md:hidden too, so the nav is always present
          beneath it. Without the offset the nav paints over this bar and the
          See-price / Enquire actions are unreachable on phones. */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t border-border bg-background/95 backdrop-blur md:hidden">
        <div className="mx-auto flex w-full max-w-5xl items-stretch gap-3 px-4 py-3">
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
            ) : state === "expired" ? (
              <>
                <span className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
                  Wholesale price
                </span>
                {/* Expired isn't a dead end: the status word itself is the
                    tappable renewal action. */}
                <GatedRenewCta
                  state="expired"
                  appearance="text"
                  label="Access expired — renew"
                />
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

          {enquireHref ? (
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
          ) : (
            // WhatsApp gate closed: anon can request access here; a signed-in
            // customer whose access isn't live sees a locked, inert button.
            <button
              type="button"
              disabled={status !== undefined}
              onClick={status === undefined ? () => setOpen(true) : undefined}
              aria-label={
                status === undefined
                  ? "Request access to enquire on WhatsApp"
                  : "WhatsApp is available to approved buyers"
              }
              className={cn(
                "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-border px-5 text-sm font-semibold text-muted-foreground outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                status === undefined ? "hover:bg-accent hover:text-foreground" : "opacity-70",
              )}
            >
              <LockIcon aria-hidden className="size-4" />
              Enquire
            </button>
          )}
        </div>
      </div>

      <RequestAccessSheet open={open} onOpenChange={setOpen} googleGateHref={googleGateHref} />
    </>
  );
}
