"use client";

import * as React from "react";
import { Package } from "lucide-react";

import { CelebrationOverlay } from "@/components/common/CelebrationOverlay";
import { SlabyBadge } from "./SlabyMark";

/**
 * "Order placed" moment for the confirmation page: a FULL-SCREEN celebration
 * takeover (confetti, draw-on check, congratulations) the FIRST time this
 * order's confirmation is seen, fading into the static header below on
 * revisits / after the show. Optionally credits Slaby (owner toggle).
 */
export function OrderCelebration({
  orderNumber,
  placedLabel,
  showSlaby,
}: {
  orderNumber: string;
  placedLabel: string;
  showSlaby: boolean;
}) {
  const [overlay, setOverlay] = React.useState(false);
  React.useEffect(() => {
    const key = `md-celebrated-${orderNumber}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      return; // storage blocked — stay static
    }
    // Scheduled (never sync in the effect body) per the repo's lint rule.
    const t = setTimeout(() => setOverlay(true), 0);
    return () => clearTimeout(t);
  }, [orderNumber]);

  return (
    <div className="flex flex-col items-center text-center">
      {overlay ? (
        <CelebrationOverlay
          title="Order placed successfully!"
          subtitle="Congratulations — your purchase request is in. We'll confirm availability and pricing with you shortly."
          footer={
            <span className="inline-flex flex-col items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5 text-sm">
                <Package className="size-4 text-muted-foreground" aria-hidden />
                <span className="font-semibold tracking-wide text-foreground tabular-nums">
                  {orderNumber}
                </span>
              </span>
              {showSlaby ? <SlabyBadge placement="orderSuccess" prefix="Powered by" /> : null}
            </span>
          }
          onDone={() => setOverlay(false)}
        />
      ) : null}

      {/* The static header that remains after (or instead of) the show. */}
      <span className="flex size-16 items-center justify-center rounded-full bg-green-500/10 text-green-600 dark:text-green-400">
        <svg viewBox="0 0 24 24" className="size-9" fill="none" aria-hidden>
          <path
            d="M4 12.5l5 5L20 6.5"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <h1 className="mt-4 text-xl font-semibold text-foreground">
        Order placed successfully!
      </h1>
      <p className="mt-1 max-w-md text-sm text-pretty text-muted-foreground">
        Congratulations — your purchase request is in. Our team will confirm
        availability and pricing with you shortly. No payment is taken now.
      </p>
      <p className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5 text-sm">
        <Package className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-muted-foreground">Order</span>
        <span className="font-semibold tracking-wide text-foreground tabular-nums">
          {orderNumber}
        </span>
      </p>
      <p className="mt-2 text-xs text-muted-foreground">Placed {placedLabel}</p>
      {showSlaby ? <SlabyBadge placement="orderSuccess" prefix="Powered by" className="mt-3" /> : null}
    </div>
  );
}
