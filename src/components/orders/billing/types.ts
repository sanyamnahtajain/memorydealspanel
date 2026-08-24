import type { OrderBillingSnapshot } from "@/lib/billing-groups/snapshot";
import { bucketBillNumber } from "@/lib/billing-groups/engine";

/**
 * Client-safe view of an order's frozen billing snapshot, shared by the admin
 * drawer, the customer order views and the confirmation page. Built from the
 * snapshot by `toOrderBillingView` on the server; `null` for orders placed
 * before the feature (those render exactly as before).
 */

export interface OrderBillingBucketView {
  code: string;
  name: string;
  /** Color token (blue, emerald, violet, amber, rose, cyan, slate). */
  color: string;
  separateBill: boolean;
  notes: string | null;
  subtotalPaise: number;
  discountPaise: number;
  /** The tier percentage that applied (basis points), or null when none did. */
  appliedPercentBps: number | null;
  netPaise: number;
  /** "MD-XXXX/DLR" — the bill sub-number for this bucket. */
  billNumber: string;
  /** Keys of the order lines in this bucket (see `lineKey`). */
  lineKeys: string[];
}

export interface OrderBillingView {
  groupDiscountPaise: number;
  buckets: OrderBillingBucketView[];
}

/** Project the frozen snapshot into the view DTO (pure). */
export function toOrderBillingView(
  snapshot: OrderBillingSnapshot | null,
  orderNumber: string,
): OrderBillingView | null {
  if (!snapshot) return null;
  return {
    groupDiscountPaise: snapshot.groupDiscountPaise,
    buckets: snapshot.buckets.map((b) => ({
      code: b.code,
      name: b.name,
      color: b.color,
      separateBill: b.separateBill,
      notes: b.notes,
      subtotalPaise: b.subtotalPaise,
      discountPaise: b.discountPaise,
      appliedPercentBps: b.appliedTier?.percentBps ?? null,
      netPaise: b.netPaise,
      billNumber: bucketBillNumber(orderNumber, b.code),
      lineKeys: b.lineKeys,
    })),
  };
}

/** "600" bps → "6%"; "1250" → "12.5%". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;
}
