import { allocateDiscount, applyRules } from "@/lib/billing-groups/engine";
import type {
  Bucket,
  BucketedCart,
  BucketableLine,
  DiscountTier,
  NextTierHint,
} from "@/lib/billing-groups/types";

/**
 * Client-side mirror of the bucket math, so the cart's bucket cards, tier
 * progress and discount rows stay coherent across OPTIMISTIC quantity changes
 * without a round-trip. Membership (which line is in which bucket) is taken
 * from the server's result; only the amounts are re-derived, through the SAME
 * pure engine functions the server runs. Display-only — the server re-buckets
 * and freezes the authoritative figures at placement.
 */

/** The minimum a group's rules need client-side: its tiers (nothing else). */
export interface GroupRules {
  groupId: string;
  tiers: DiscountTier[];
}

/** What the client knows about a line right now. */
export interface LiveLine {
  key: string;
  /** Integer paise, or null when gated / unpriced. */
  lineTotalPaise: number | null;
  available: boolean;
}

/**
 * Re-run the bucket amounts for the CURRENT lines.
 *  - A line keeps the bucket the server put it in (by key).
 *  - A line the server didn't bucket (e.g. restored after a failed remove)
 *    lands in General — the same fallback the engine uses for no match.
 *  - Buckets that empty out are dropped; bucket order is preserved.
 *  - Unavailable / unpriced lines are excluded (they aren't orderable).
 */
export function rebucket(
  initial: BucketedCart,
  lines: LiveLine[],
  rules: GroupRules[],
): BucketedCart {
  const bucketIndexByKey = new Map<string, number>();
  initial.buckets.forEach((b, i) => {
    for (const l of b.lines) bucketIndexByKey.set(l.key, i);
  });
  let generalIndex = initial.buckets.findIndex((b) => b.groupId === null);

  const templates: Bucket[] = initial.buckets.slice();
  if (generalIndex === -1) {
    templates.push(generalTemplate());
    generalIndex = templates.length - 1;
  }

  const linesByBucket: BucketableLine[][] = templates.map(() => []);
  for (const l of lines) {
    if (!l.available || l.lineTotalPaise === null) continue;
    const idx = bucketIndexByKey.get(l.key) ?? generalIndex;
    linesByBucket[idx].push({ key: l.key, brandId: null, lineTotalPaise: l.lineTotalPaise });
  }

  const tiersByGroup = new Map<string, DiscountTier[][]>();
  for (const r of rules) {
    const list = tiersByGroup.get(r.groupId) ?? [];
    list.push(r.tiers);
    tiersByGroup.set(r.groupId, list);
  }

  const buckets: Bucket[] = [];
  templates.forEach((t, i) => {
    const bucketLines = linesByBucket[i];
    if (bucketLines.length === 0) return;
    const subtotalPaise = bucketLines.reduce((s, l) => s + l.lineTotalPaise, 0);
    const groupTiers = t.groupId ? (tiersByGroup.get(t.groupId) ?? []) : [];
    const { discountPaise, appliedTier, nextTier } = applyRules(
      groupTiers.map((tiers) => ({ kind: "tieredPercent" as const, tiers })),
      subtotalPaise,
    );
    buckets.push({
      groupId: t.groupId,
      code: t.code,
      name: t.name,
      color: t.color,
      separateBill: t.separateBill,
      couponStacking: t.couponStacking,
      notes: t.notes,
      lines: allocateDiscount(bucketLines, discountPaise),
      subtotalPaise,
      discountPaise,
      appliedTier,
      nextTier,
      netPaise: subtotalPaise - discountPaise,
    });
  });

  const subtotalPaise = buckets.reduce((s, b) => s + b.subtotalPaise, 0);
  const groupDiscountPaise = buckets.reduce((s, b) => s + b.discountPaise, 0);
  return {
    buckets,
    subtotalPaise,
    groupDiscountPaise,
    netPaise: subtotalPaise - groupDiscountPaise,
    isSplit: buckets.length > 1,
  };
}

function generalTemplate(): Bucket {
  return {
    groupId: null,
    code: "GEN",
    name: "General",
    color: "slate",
    separateBill: false,
    couponStacking: true,
    notes: null,
    lines: [],
    subtotalPaise: 0,
    discountPaise: 0,
    appliedTier: null,
    nextTier: null,
    netPaise: 0,
  };
}

/**
 * Whether the cart should render as bucket cards. A lone General bucket with
 * nothing to say renders the flat list — zero visual change for stores
 * without groups.
 */
export function shouldRenderBuckets(cart: BucketedCart | null): cart is BucketedCart {
  if (!cart) return false;
  if (cart.isSplit) return true;
  return cart.buckets.some(
    (b) => b.groupId !== null && (b.discountPaise > 0 || b.nextTier !== null),
  );
}

/** The nearest unlock across all buckets — for the one-line mobile nudge. */
export function closestNextTier(
  cart: BucketedCart | null,
): { bucket: Bucket; hint: NextTierHint } | null {
  if (!cart) return null;
  let best: { bucket: Bucket; hint: NextTierHint } | null = null;
  for (const bucket of cart.buckets) {
    if (!bucket.nextTier) continue;
    if (!best || bucket.nextTier.remainingPaise < best.hint.remainingPaise) {
      best = { bucket, hint: bucket.nextTier };
    }
  }
  return best;
}

/** Basis points → "6%" / "6.5%". */
export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0+$/, "")}%`;
}
