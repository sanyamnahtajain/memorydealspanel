"use client";

/**
 * PriceReveal — the "unlock" moment of the storefront.
 *
 * Given an approved viewer's price (integer paise), this animates a brief
 * un-blur + count-up so the reveal is *felt*, not merely shown. An optional
 * MRP renders as a struck-through reference with a derived discount badge.
 *
 * SAFETY: this component only ever receives a `paise` amount that the server
 * already decided the viewer may see (canSeePrices === true). It is never
 * rendered for anon / pending / expired viewers — those paths render the
 * locked chip in PriceGateCard instead and no price is passed to the client.
 */

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { AnimatedNumber } from "@/components/motion/primitives";
import { formatPaise } from "@/lib/money";
import { cn } from "@/lib/utils";

const SIZE_CLASSES = {
  sm: { price: "text-base", mrp: "text-xs", badge: "text-[0.65rem] px-1.5 py-0.5" },
  md: { price: "text-xl", mrp: "text-sm", badge: "text-xs px-1.5 py-0.5" },
  lg: { price: "text-3xl", mrp: "text-base", badge: "text-xs px-2 py-0.5" },
} as const;

type PriceRevealSize = keyof typeof SIZE_CLASSES;

interface PriceRevealProps {
  /** Selling price in integer paise (49950 = ₹499.50). */
  paise: number;
  /** Optional MRP in integer paise; rendered struck-through when higher. */
  mrp?: number | null;
  /** Pre-derived whole-number discount percentage vs. mrp (from the DTO). */
  marginPct?: number | null;
  size?: PriceRevealSize;
  /** Count-up + un-blur on mount. Disabled for e.g. list re-renders. */
  animate?: boolean;
  className?: string;
}

/**
 * Derives the discount percentage from price/mrp when the DTO didn't already
 * supply one (defensive — the DAL normally provides `marginPct`).
 */
function resolveMarginPct(
  paise: number,
  mrp: number | null | undefined,
  marginPct: number | null | undefined,
): number | null {
  if (marginPct !== null && marginPct !== undefined) {
    return marginPct > 0 ? marginPct : null;
  }
  if (mrp === null || mrp === undefined || mrp <= 0 || mrp <= paise) {
    return null;
  }
  return Math.round(((mrp - paise) / mrp) * 100);
}

export function PriceReveal({
  paise,
  mrp,
  marginPct,
  size = "md",
  animate = true,
  className,
}: PriceRevealProps) {
  const reduced = useReducedMotion();
  const sizes = SIZE_CLASSES[size];
  const shouldAnimate = animate && !reduced;

  const discount = resolveMarginPct(paise, mrp, marginPct);
  const showMrp = mrp !== null && mrp !== undefined && mrp > paise;

  return (
    <div
      data-slot="price-reveal"
      className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-1", className)}
    >
      <motion.span
        className={cn(
          "font-tabular font-semibold text-foreground",
          sizes.price,
        )}
        initial={shouldAnimate ? { filter: "blur(8px)", opacity: 0, y: 4 } : false}
        animate={{ filter: "blur(0px)", opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      >
        <AnimatedNumber
          value={paise}
          format={(v) => formatPaise(Math.max(0, Math.round(v)))}
        />
      </motion.span>

      {showMrp ? (
        <motion.span
          className="flex items-baseline gap-1.5"
          initial={shouldAnimate ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          <span
            className={cn(
              "font-tabular text-muted-foreground line-through decoration-muted-foreground/60",
              sizes.mrp,
            )}
          >
            {formatPaise(mrp!)}
          </span>
          {discount !== null ? (
            <span
              className={cn(
                "inline-flex w-fit shrink-0 items-center rounded-full border border-success/25 bg-success/10 font-medium text-success",
                sizes.badge,
              )}
            >
              {discount}% off
            </span>
          ) : null}
        </motion.span>
      ) : null}
    </div>
  );
}
