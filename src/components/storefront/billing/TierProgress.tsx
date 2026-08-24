"use client";

import { motion, useReducedMotion } from "motion/react";
import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatPaise } from "@/lib/money";
import type { AppliedTier, NextTierHint } from "@/lib/billing-groups/types";
import { groupColorClasses } from "./colors";
import { formatBps } from "./bucket-math";

interface TierProgressProps {
  subtotalPaise: number;
  appliedTier: AppliedTier | null;
  nextTier: NextTierHint | null;
  color: string;
}

/**
 * Progress toward the next discount tier of a bucket. Renders nothing for a
 * bucket with no tiers at all (no applied, no next). Amounts are shown only
 * by a priced parent — this component is never mounted for a gated viewer.
 */
export function TierProgress({ subtotalPaise, appliedTier, nextTier, color }: TierProgressProps) {
  const reduced = useReducedMotion();
  const c = groupColorClasses(color);
  if (!appliedTier && !nextTier) return null;

  const max = nextTier ? nextTier.tier.fromPaise : Math.max(1, subtotalPaise);
  const now = Math.min(subtotalPaise, max);
  const pct = Math.max(0, Math.min(100, (now / max) * 100));

  return (
    <div className="flex flex-col gap-1.5">
      <p className={cn("text-xs font-medium", c.text)}>
        {nextTier ? (
          <>
            Add {formatPaise(nextTier.remainingPaise)} more to unlock{" "}
            {formatBps(nextTier.tier.percentBps)}
            {appliedTier ? (
              <span className="font-normal text-muted-foreground">
                {" "}
                · now {formatBps(appliedTier.percentBps)}
              </span>
            ) : null}
          </>
        ) : (
          <span className="inline-flex items-center gap-1">
            <Sparkles className="size-3.5" aria-hidden />
            Best tier unlocked · {formatBps(appliedTier!.percentBps)}
          </span>
        )}
      </p>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={now}
        aria-label={
          nextTier
            ? `Progress toward the ${formatBps(nextTier.tier.percentBps)} tier`
            : "Best discount tier reached"
        }
        className={cn("h-1.5 w-full overflow-hidden rounded-full", c.track)}
      >
        <motion.div
          className={cn("h-full rounded-full", c.progress)}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: reduced ? 0 : 0.35, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}
