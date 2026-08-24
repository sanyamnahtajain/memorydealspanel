import type { AppliedTier, BucketedCart } from "./types";

/**
 * The billing snapshot FROZEN onto an Order at placement (`Order.billingGroups`).
 *
 * Rules change on production whenever the owner likes; an order must keep
 * showing the buckets and discounts it was actually placed with. So we store
 * the resolved result — not the rule ids — and render history from this alone.
 * Lines are referenced by their stable key (productId:variantId) into the
 * order's own `items` snapshot, so nothing is duplicated.
 *
 * Absent (null) on orders placed before the feature, or whose cart had only
 * the implicit General bucket and no discount — those render as before.
 */

export const BILLING_SNAPSHOT_VERSION = 1 as const;

export interface OrderBucketSnapshot {
  /** Group id at placement (null for General). Informational only. */
  groupId: string | null;
  code: string;
  name: string;
  color: string;
  separateBill: boolean;
  notes: string | null;
  /** Keys of the order lines in this bucket (see `lineKey`). */
  lineKeys: string[];
  /** Per-line discount share, keyed like `lineKeys` (integer paise). */
  lineDiscounts: Record<string, number>;
  subtotalPaise: number;
  discountPaise: number;
  appliedTier: AppliedTier | null;
  netPaise: number;
}

export interface OrderBillingSnapshot {
  version: typeof BILLING_SNAPSHOT_VERSION;
  buckets: OrderBucketSnapshot[];
  subtotalPaise: number;
  groupDiscountPaise: number;
}

/** Stable key for a cart/order line — the same on both sides of placement. */
export function lineKey(productId: string, variantId: string | null | undefined): string {
  return `${productId}:${variantId ?? ""}`;
}

/**
 * Build the snapshot from an engine result. Returns `null` when there is
 * nothing worth freezing (a single General bucket with no discount) so such
 * orders stay byte-for-byte pre-feature.
 */
export function toOrderBillingSnapshot(cart: BucketedCart): OrderBillingSnapshot | null {
  const onlyGeneral =
    cart.buckets.length <= 1 && cart.buckets.every((b) => b.groupId === null);
  if (onlyGeneral && cart.groupDiscountPaise === 0) return null;
  return {
    version: BILLING_SNAPSHOT_VERSION,
    buckets: cart.buckets.map((b) => ({
      groupId: b.groupId,
      code: b.code,
      name: b.name,
      color: b.color,
      separateBill: b.separateBill,
      notes: b.notes,
      lineKeys: b.lines.map((l) => l.key),
      lineDiscounts: Object.fromEntries(b.lines.map((l) => [l.key, l.discountPaise])),
      subtotalPaise: b.subtotalPaise,
      discountPaise: b.discountPaise,
      appliedTier: b.appliedTier,
      netPaise: b.netPaise,
    })),
    subtotalPaise: cart.subtotalPaise,
    groupDiscountPaise: cart.groupDiscountPaise,
  };
}

/** Defensive read of the stored JSON: anything malformed → null (render as before). */
export function parseOrderBillingSnapshot(value: unknown): OrderBillingSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<OrderBillingSnapshot>;
  if (v.version !== BILLING_SNAPSHOT_VERSION || !Array.isArray(v.buckets)) return null;
  const buckets: OrderBucketSnapshot[] = [];
  for (const b of v.buckets as unknown[]) {
    if (!b || typeof b !== "object") return null;
    const x = b as Partial<OrderBucketSnapshot>;
    if (
      typeof x.code !== "string" ||
      typeof x.name !== "string" ||
      !Array.isArray(x.lineKeys) ||
      typeof x.subtotalPaise !== "number" ||
      typeof x.discountPaise !== "number"
    ) {
      return null;
    }
    buckets.push({
      groupId: typeof x.groupId === "string" ? x.groupId : null,
      code: x.code,
      name: x.name,
      color: typeof x.color === "string" ? x.color : "slate",
      separateBill: x.separateBill === true,
      notes: typeof x.notes === "string" ? x.notes : null,
      lineKeys: x.lineKeys.filter((k): k is string => typeof k === "string"),
      lineDiscounts:
        x.lineDiscounts && typeof x.lineDiscounts === "object"
          ? Object.fromEntries(
              Object.entries(x.lineDiscounts).filter(
                (e): e is [string, number] => typeof e[1] === "number",
              ),
            )
          : {},
      subtotalPaise: x.subtotalPaise,
      discountPaise: x.discountPaise,
      appliedTier:
        x.appliedTier &&
        typeof x.appliedTier === "object" &&
        typeof x.appliedTier.fromPaise === "number" &&
        typeof x.appliedTier.percentBps === "number"
          ? { fromPaise: x.appliedTier.fromPaise, percentBps: x.appliedTier.percentBps }
          : null,
      netPaise:
        typeof x.netPaise === "number" ? x.netPaise : x.subtotalPaise - x.discountPaise,
    });
  }
  return {
    version: BILLING_SNAPSHOT_VERSION,
    buckets,
    subtotalPaise:
      typeof v.subtotalPaise === "number"
        ? v.subtotalPaise
        : buckets.reduce((s, b) => s + b.subtotalPaise, 0),
    groupDiscountPaise:
      typeof v.groupDiscountPaise === "number"
        ? v.groupDiscountPaise
        : buckets.reduce((s, b) => s + b.discountPaise, 0),
  };
}
