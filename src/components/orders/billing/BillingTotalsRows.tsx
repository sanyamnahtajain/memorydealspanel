import * as React from "react";

import { formatPaise } from "@/lib/money";
import { formatBps, type OrderBillingView } from "./types";

/**
 * BillingTotalsRows — the "Bucket discounts −₹X" row for an order's totals
 * block, with a tiny per-bucket breakdown beneath. Renders nothing when no
 * bucket discount applied, so totals blocks can include it unconditionally.
 */
export function BillingTotalsRows({ billing }: { billing: OrderBillingView | null }) {
  if (!billing || billing.groupDiscountPaise <= 0) return null;
  const discounted = billing.buckets.filter((b) => b.discountPaise > 0);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-300">
        <span className="text-sm font-medium">Bucket discounts</span>
        <span className="text-sm font-semibold tabular-nums">
          −{formatPaise(billing.groupDiscountPaise)}
        </span>
      </div>
      {discounted.length > 0 ? (
        <ul className="space-y-0.5 pl-3 text-[0.7rem] text-muted-foreground">
          {discounted.map((b) => (
            <li key={b.code} className="flex items-center justify-between">
              <span>
                {b.name}
                {b.appliedPercentBps !== null ? ` · ${formatBps(b.appliedPercentBps)}` : ""}
              </span>
              <span className="tabular-nums">−{formatPaise(b.discountPaise)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
