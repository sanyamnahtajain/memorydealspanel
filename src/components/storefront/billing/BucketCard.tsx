"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { FileText } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatPaise } from "@/lib/money";
import type { Bucket } from "@/lib/billing-groups/types";
import { groupColorClasses } from "./colors";
import { formatBps } from "./bucket-math";
import { TierProgress } from "./TierProgress";

interface BucketCardProps {
  bucket: Bucket;
  /** Whether amounts may be shown (price gate). */
  priced: boolean;
  /** The bucket's line rows (already rendered by the cart). */
  children: React.ReactNode;
}

/**
 * One billing bucket of the cart: a colour-accented header (name, code badge,
 * "Billed separately" chip), the line rows, and a footer with the bucket
 * subtotal, the applied tier discount and progress toward the next tier.
 */
export function BucketCard({ bucket, priced, children }: BucketCardProps) {
  const reduced = useReducedMotion();
  const c = groupColorClasses(bucket.color);
  const headingId = React.useId();
  const hasTiers = bucket.appliedTier !== null || bucket.nextTier !== null;
  const showFooter = priced && (hasTiers || bucket.discountPaise > 0);

  return (
    <motion.section
      aria-labelledby={headingId}
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
      transition={{ duration: reduced ? 0 : 0.2 }}
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <header className="relative flex items-center gap-2 px-3 py-2.5 pl-4 sm:px-4 sm:pl-5">
        <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", c.bar)} />
        <h2 id={headingId} className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {bucket.name}
        </h2>
        {bucket.separateBill ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[0.65rem] font-medium text-muted-foreground">
            <FileText className="size-3" aria-hidden />
            Billed separately
          </span>
        ) : null}
        <span
          className={cn(
            "rounded-md px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold tracking-wide",
            c.badge,
          )}
          aria-label={`Group code ${bucket.code}`}
        >
          {bucket.code}
        </span>
      </header>

      <div className="border-t border-border p-3 sm:p-3">{children}</div>

      {showFooter ? (
        <footer className="flex flex-col gap-2.5 border-t border-border bg-muted/20 px-3 py-3 sm:px-4">
          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">{bucket.name} subtotal</dt>
              <dd className="font-medium tabular-nums">{formatPaise(bucket.subtotalPaise)}</dd>
            </div>
            {bucket.appliedTier && bucket.discountPaise > 0 ? (
              <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-300">
                <dt>
                  {formatBps(bucket.appliedTier.percentBps)} {bucket.name.toLowerCase()} discount
                </dt>
                <dd className="font-medium tabular-nums">−{formatPaise(bucket.discountPaise)}</dd>
              </div>
            ) : null}
          </dl>
          <TierProgress
            subtotalPaise={bucket.subtotalPaise}
            appliedTier={bucket.appliedTier}
            nextTier={bucket.nextTier}
            color={bucket.color}
          />
          {bucket.notes ? (
            <p className="text-[0.7rem] leading-relaxed text-muted-foreground">{bucket.notes}</p>
          ) : null}
        </footer>
      ) : bucket.notes ? (
        <p className="border-t border-border px-3 py-2 text-[0.7rem] leading-relaxed text-muted-foreground sm:px-4">
          {bucket.notes}
        </p>
      ) : null}
    </motion.section>
  );
}
