"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { Package } from "lucide-react";

import { SlabyBadge } from "./SlabyMark";

/**
 * Animated "order placed" celebration for the confirmation page (owner
 * request): a draw-on check, a soft confetti burst, and a congratulations
 * line — played ONCE per order (sessionStorage), quietly static on revisits
 * and for reduced-motion users. Optionally credits Slaby underneath.
 */

const CONFETTI = [
  { x: -70, y: -58, c: "bg-emerald-500", d: 0.05 },
  { x: 64, y: -70, c: "bg-blue-500", d: 0.1 },
  { x: -96, y: -6, c: "bg-amber-500", d: 0.15 },
  { x: 96, y: -14, c: "bg-rose-500", d: 0.2 },
  { x: -52, y: 54, c: "bg-violet-500", d: 0.25 },
  { x: 58, y: 48, c: "bg-cyan-500", d: 0.3 },
  { x: 6, y: -88, c: "bg-primary", d: 0.35 },
  { x: -20, y: 76, c: "bg-emerald-500", d: 0.4 },
];

export function OrderCelebration({
  orderNumber,
  placedLabel,
  showSlaby,
}: {
  orderNumber: string;
  placedLabel: string;
  showSlaby: boolean;
}) {
  const reduced = useReducedMotion();
  // Play the show only the FIRST time this order's confirmation is seen.
  const [animate, setAnimate] = React.useState(false);
  React.useEffect(() => {
    const key = `md-celebrated-${orderNumber}`;
    let fresh = false;
    try {
      if (!window.sessionStorage.getItem(key)) {
        window.sessionStorage.setItem(key, "1");
        fresh = true;
      }
    } catch {
      /* storage blocked — stay static */
    }
    if (!fresh) return;
    // Scheduled (never sync in the effect body) per the repo's lint rule.
    const t = setTimeout(() => setAnimate(true), 0);
    return () => clearTimeout(t);
  }, [orderNumber]);

  const play = animate && !reduced;

  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative">
        {/* Confetti burst (one-shot, decorative). */}
        {play &&
          CONFETTI.map((p, i) => (
            <motion.span
              key={i}
              aria-hidden
              initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
              animate={{ x: p.x, y: p.y, opacity: 0, scale: 0.4 }}
              transition={{ duration: 0.9, delay: 0.25 + p.d, ease: "easeOut" }}
              className={`absolute top-1/2 left-1/2 size-2 rounded-full ${p.c}`}
            />
          ))}
        <motion.span
          initial={play ? { scale: 0.5, opacity: 0 } : false}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 16 }}
          className="flex size-16 items-center justify-center rounded-full bg-green-500/10 text-green-600 dark:text-green-400"
        >
          {/* Draw-on check. */}
          <svg viewBox="0 0 24 24" className="size-9" fill="none" aria-hidden>
            <motion.path
              d="M4 12.5l5 5L20 6.5"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={play ? { pathLength: 0 } : { pathLength: 1 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
            />
          </svg>
        </motion.span>
      </div>

      <motion.div
        initial={play ? { opacity: 0, y: 10 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="flex flex-col items-center"
      >
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
      </motion.div>
    </div>
  );
}
