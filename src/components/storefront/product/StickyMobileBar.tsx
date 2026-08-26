"use client";

/**
 * StickyMobileBar — a mobile-only sticky action bar pinned to the bottom of
 * the product detail viewport ("See price / Enquire", and — for a priced
 * viewer on a plain in-stock product — a one-tap "Add to cart", see
 * `addToCart` below).
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
 * panel + Enquire button already sit in view, so the bar is hidden via CSS
 * (`md:hidden`) and its spacer likewise.
 *
 * ENTRANCE: the bar springs up only while the page's PRICE PANEL
 * (#pdp-price-panel — see ./price-panel.ts) is OFF screen, so the viewport
 * never shows the same price/CTA twice. An IntersectionObserver watches the
 * panel; while it is visible the bar sits faded + slid down and inert.
 * Reduced motion swaps the spring for an instant show/hide.
 */

import * as React from "react";
import { Loader2, LockIcon, MessageCircle, ShoppingCart } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import type { CustomerStatus } from "@/lib/schemas/shared";
import { accessCopy, resolveAccessState } from "@/lib/access-status";
import { springs } from "@/components/motion/tokens";
import { RequestAccessSheet } from "@/components/storefront/RequestAccessSheet";
import { GatedRenewCta } from "@/components/storefront/GatedRenewCta";
import { useAddToCart } from "@/components/storefront/cart/useAddToCart";
import { minOrderableQty } from "@/lib/quantity";
import { cn } from "@/lib/utils";
import { PRICE_PANEL_ID } from "./price-panel";

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
  /**
   * One-tap add-to-cart config — set ONLY for a PRICED viewer on a plain
   * in-stock product (non-variant, non-allocation). When present, the bar's
   * primary slot becomes a real "Add to cart" (the exact AddToCartButton
   * flow, adding the pack-aligned MOQ) and Enquire collapses to an icon.
   * When absent — every gated viewer, variant products (choosing happens in
   * the selector), allocation products (the breakdown builder is the flow),
   * out-of-stock — the bar renders exactly as before. Carries NO money:
   * ids and quantity rules only.
   */
  addToCart?: {
    productId: string;
    moq: number | null;
    packMultiple: number | null;
  } | null;
}

/**
 * The bar's one-tap "Add to cart" primary button. A separate component so the
 * add hook only mounts when the bar actually offers the add (hooks cannot be
 * conditional inside StickyMobileBar itself). Adds the same MOQ-respecting
 * default quantity AddToCartButton seeds its stepper with — the pack-aligned
 * MOQ — through the same shared flow (action, toasts, broadcasts).
 */
function StickyAddToCartButton({
  productId,
  moq,
  packMultiple,
}: {
  productId: string;
  moq: number | null;
  packMultiple: number | null;
}) {
  const { pending, add } = useAddToCart({ productId, moq, packMultiple });
  const quantity = minOrderableQty(moq, packMultiple);

  return (
    <button
      type="button"
      aria-busy={pending || undefined}
      disabled={pending}
      onClick={() => add(quantity)}
      className={cn(
        "inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm outline-none transition-[background-color,transform] hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]",
        "disabled:pointer-events-none disabled:opacity-70",
      )}
    >
      {pending ? (
        <Loader2 aria-hidden className="size-4 animate-spin" />
      ) : (
        <ShoppingCart aria-hidden className="size-4" />
      )}
      {pending ? "Adding…" : "Add to cart"}
    </button>
  );
}

export function StickyMobileBar({
  enquireHref,
  canSeePrices,
  priceLabel,
  status,
  googleGateHref = null,
  addToCart = null,
}: StickyMobileBarProps) {
  const reduced = useReducedMotion();
  const [open, setOpen] = React.useState(false);
  // True once the price panel has scrolled OUT of view — the bar's cue to
  // enter. Starts false (panel is normally in the first viewport-and-a-bit),
  // and the observer fires immediately on mount to correct it either way.
  const [panelAway, setPanelAway] = React.useState(false);

  React.useEffect(() => {
    const panel = document.getElementById(PRICE_PANEL_ID);
    if (!panel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setPanelAway(!entry.isIntersecting);
      },
      // Trim the top ~header's height off the intersection root: once only the
      // panel's tail is peeking under the sticky header (or the page bottomed
      // out with just the tail on screen), the panel counts as GONE and the
      // bar may enter. Without this, short pages pin a sliver of the panel on
      // screen forever and the bar never appears.
      { rootMargin: "-96px 0px 0px 0px", threshold: 0 },
    );
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  const showPrice = canSeePrices && priceLabel !== undefined;
  // One-tap add — ONLY alongside a live price (the prop is never set for a
  // gated viewer; this guard is belt-and-braces, not the gate).
  const showAdd = showPrice && addToCart != null;
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
          bar height + that offset. Reserved even while the bar is hidden so
          content never jumps when it springs in. */}
      <div aria-hidden className="h-[calc(8rem+env(safe-area-inset-bottom))] md:hidden" />

      {/* Sits ABOVE the storefront bottom tab nav (fixed bottom-0 z-40 md:hidden,
          ~3.5rem tall); this bar is md:hidden too, so the nav is always present
          beneath it. Without the offset the nav paints over this bar and the
          See-price / Enquire actions are unreachable on phones. */}
      <motion.div
        initial={false}
        animate={
          panelAway ? { y: 0, opacity: 1 } : { y: 24, opacity: 0 }
        }
        transition={reduced ? { duration: 0 } : springs.gentle}
        // `inert` (not aria-hidden) — removes the hidden bar's links/buttons
        // from focus order AND the a11y tree in one attribute.
        inert={!panelAway}
        className={cn(
          "fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t border-border/60 bg-background/95 shadow-[0_-10px_28px_-18px_rgb(0_0_0/0.35)] backdrop-blur-md md:hidden",
          !panelAway && "pointer-events-none",
        )}
      >
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

          {showAdd && addToCart ? (
            <>
              {/* Enquire collapses to an icon so the primary slot is the
                  one-tap add. Same gate logic as the wide button below: a
                  live wa.me link, else a locked inert affordance. */}
              {enquireHref ? (
                <a
                  href={enquireHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Enquire on WhatsApp"
                  className="inline-flex size-12 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground outline-none transition-[background-color,color,transform] hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
                >
                  <MessageCircle aria-hidden className="size-4" />
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  aria-label="WhatsApp is available to approved buyers"
                  className="inline-flex size-12 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground opacity-70"
                >
                  <LockIcon aria-hidden className="size-4" />
                </button>
              )}
              <StickyAddToCartButton
                productId={addToCart.productId}
                moq={addToCart.moq}
                packMultiple={addToCart.packMultiple}
              />
            </>
          ) : enquireHref ? (
            <a
              href={enquireHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Enquire on WhatsApp"
              className={cn(
                "inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm outline-none transition-[background-color,transform] hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]",
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
                "inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full border border-border px-6 text-sm font-semibold text-muted-foreground outline-none transition-[background-color,color,transform] focus-visible:ring-3 focus-visible:ring-ring/50",
                status === undefined
                  ? "hover:bg-accent hover:text-foreground active:scale-[0.97]"
                  : "opacity-70",
              )}
            >
              <LockIcon aria-hidden className="size-4" />
              Enquire
            </button>
          )}
        </div>
      </motion.div>

      <RequestAccessSheet open={open} onOpenChange={setOpen} googleGateHref={googleGateHref} />
    </>
  );
}
