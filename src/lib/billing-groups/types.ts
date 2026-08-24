/**
 * Billing groups — the domain model (pure, no server imports).
 *
 * A BILLING GROUP is a named bucket a cart is split into, decided by a
 * MATCHER over the cart lines (today: by brand), with RULES that run on the
 * bucket (today: a tiered percentage discount on the bucket subtotal). Each
 * group can be billed on its own bill page. Everything a line doesn't match
 * falls into the implicit GENERAL bucket, which has no rules — so a store
 * with no groups configured behaves exactly as before.
 *
 * Both `matcher` and `rules` are tagged unions so new kinds (categories, tags,
 * flat-off, free shipping…) are additive — a new `kind`, never a schema change.
 */

/* ------------------------------------------------------------------ */
/* Matchers                                                            */
/* ------------------------------------------------------------------ */

export type BillingGroupMatcher = {
  kind: "brands";
  /** Brand ids (Brand master) whose products belong to this group. */
  brandIds: string[];
};

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

/** One tier: applies when the bucket subtotal is >= `fromPaise`. */
export interface DiscountTier {
  fromPaise: number;
  /** Basis points: 400 = 4%. */
  percentBps: number;
}

export type BillingGroupRule = {
  kind: "tieredPercent";
  /** Ascending by `fromPaise`; the highest tier whose floor is met wins. */
  tiers: DiscountTier[];
};

/* ------------------------------------------------------------------ */
/* Group config (what the admin edits; what the DB stores)             */
/* ------------------------------------------------------------------ */

export interface BillingGroupConfig {
  id: string;
  name: string;
  /** Short uppercase tag (2–6 chars), printed on the bucket's bill number. */
  code: string;
  /** Token name for chips/cards (e.g. "blue"); see GROUP_COLORS. */
  color: string;
  active: boolean;
  /** Lower sorts first; also the match precedence when brands overlap. */
  sortOrder: number;
  matcher: BillingGroupMatcher;
  rules: BillingGroupRule[];
  /** Print this bucket on its own bill page with its own bill sub-number. */
  separateBill: boolean;
  /** May a coupon apply on top of this group's discount? */
  couponStacking: boolean;
  /** Free-text terms printed under the bucket's bill (optional). */
  notes: string | null;
}

/** The implicit catch-all bucket (never stored). */
export const GENERAL_GROUP_CODE = "GEN";
export const GENERAL_GROUP_NAME = "General";

/** Color tokens a group may use — map to Tailwind classes in the UI. */
export const GROUP_COLORS = [
  "blue",
  "emerald",
  "violet",
  "amber",
  "rose",
  "cyan",
  "slate",
] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

/* ------------------------------------------------------------------ */
/* Engine input / output                                               */
/* ------------------------------------------------------------------ */

/** The minimum a cart/order line must expose for bucketing. */
export interface BucketableLine {
  /** Stable line key (cartItem id / snapshot index). */
  key: string;
  brandId: string | null;
  /** Integer paise, the line's pre-discount total. */
  lineTotalPaise: number;
}

export interface LineAllocation {
  key: string;
  lineTotalPaise: number;
  /** This line's share of the bucket discount (integer paise). */
  discountPaise: number;
  /** lineTotalPaise - discountPaise. */
  netPaise: number;
}

export interface AppliedTier {
  fromPaise: number;
  percentBps: number;
}

export interface NextTierHint {
  /** The tier that would apply if the bucket grew. */
  tier: AppliedTier;
  /** How much more (paise) the bucket needs to reach it. */
  remainingPaise: number;
}

export interface Bucket {
  /** Group id, or `null` for the implicit General bucket. */
  groupId: string | null;
  code: string;
  name: string;
  color: string;
  separateBill: boolean;
  couponStacking: boolean;
  notes: string | null;
  lines: LineAllocation[];
  /** Sum of line totals, before any discount. */
  subtotalPaise: number;
  /** The tiered discount applied to this bucket (0 when none). */
  discountPaise: number;
  /** The tier that fired, or null. */
  appliedTier: AppliedTier | null;
  /** The next reachable tier, for the "add ₹X more" nudge. */
  nextTier: NextTierHint | null;
  /** subtotalPaise - discountPaise. */
  netPaise: number;
}

export interface BucketedCart {
  buckets: Bucket[];
  /** Σ bucket subtotals (== the plain cart subtotal). */
  subtotalPaise: number;
  /** Σ bucket discounts. */
  groupDiscountPaise: number;
  /** subtotalPaise - groupDiscountPaise. */
  netPaise: number;
  /** True when more than one bucket has lines (the UI splits the cart). */
  isSplit: boolean;
}
