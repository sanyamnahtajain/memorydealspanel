/**
 * "Should this shop get prices again?" — the facts an admin needs at the
 * moment of approving, and ONE verdict computed from them (owner request).
 *
 * The problem it solves: price access lapses 30 days after approval unless the
 * buyer orders. Some shops never order — they ask again, get approved again,
 * look at prices, and ask again. The admin approving on a phone had no way to
 * see that, so the same shop was approved two, three, five times. Every
 * surface that GIVES access (request queue, renewals, customer profile, bulk
 * bars) now shows this review, and the server refuses a "hold" approval unless
 * the admin types why.
 *
 * Pure: no server imports. The server builds `AccessHistory` in one batched
 * pass (`src/server/services/access-review.ts`) and ships the finished review
 * to the client, so every screen says exactly the same thing.
 */

/** Tunables in one place. Change here; every screen and the server follow. */
export const ACCESS_REVIEW_POLICY = {
  /** "Recent" for orders and product views, in days. */
  recentDays: 30,
  /** Approvals with no order after them before the admin is warned. */
  warnAfterUnusedApprovals: 1,
  /** …and before approving is held (needs a typed reason). */
  holdAfterUnusedApprovals: 2,
} as const;

/** One point on the shop's approval/order trail (ISO date). */
export interface TrailEvent {
  kind: "approval" | "order";
  at: string;
  /** Approvals only: no order followed it before the next approval / now. */
  unused?: boolean;
}

/**
 * How many recent events the server sends. Screens fold runs into "×N"
 * points (see AccessTrail), so this can be generous without crowding.
 */
export const TRAIL_MAX = 16;

/** Raw, serialisable facts about one customer (ISO dates). */
export interface AccessHistory {
  /** Orders that count — everything except CANCELLED. */
  ordersTotal: number;
  /** Orders placed within `recentDays`. */
  ordersRecent: number;
  cancelledTotal: number;
  lastOrderAt: string | null;
  /** Times an ADMIN gave access (system auto-renewals excluded). */
  approvalsTotal: number;
  /** Of those, approvals given after the last real order (or all, if none). */
  approvalsSinceLastOrder: number;
  lastApprovedAt: string | null;
  /** Times a request from this shop was rejected. */
  rejectionsTotal: number;
  /** Product pages viewed within `recentDays`. */
  viewsRecent: number;
  /** The latest approvals and orders, oldest first (at most TRAIL_MAX). */
  trail: TrailEvent[];
  /** Trail points older than the ones kept. */
  trailEarlier: number;
}

export type AccessReviewLevel =
  /** Never approved before — a first look. */
  | "new"
  /** Has ordered after its last approval. */
  | "good"
  /** Approved before, no order after it yet. Approve with care. */
  | "watch"
  /** Approved again and again, never ordered after. Held: needs a reason. */
  | "hold";

export type FactTone = "neutral" | "success" | "warning" | "destructive";

export interface AccessFact {
  label: string;
  tone: FactTone;
}

export interface AccessReview {
  level: AccessReviewLevel;
  /** One plain sentence: what this shop has done. */
  headline: string;
  /** Short chips backing the headline. */
  facts: AccessFact[];
  /** Plain advice for the admin; null when nothing needs saying. */
  advice: string | null;
  /** Prefilled reject reason that fits this shop, if any. */
  suggestedRejectReason: string | null;
  history: AccessHistory;
}

export const EMPTY_HISTORY: AccessHistory = {
  ordersTotal: 0,
  ordersRecent: 0,
  cancelledTotal: 0,
  lastOrderAt: null,
  approvalsTotal: 0,
  approvalsSinceLastOrder: 0,
  lastApprovedAt: null,
  rejectionsTotal: 0,
  viewsRecent: 0,
  trail: [],
  trailEarlier: 0,
};

/**
 * Merge approvals and orders into the trail a person reads left to right:
 * oldest first, each approval marked "unused" when no order came after it
 * before the next approval (or now). Only the last `max` points are kept.
 */
export function buildTrail(
  approvals: readonly string[],
  orders: readonly string[],
  max: number = TRAIL_MAX,
): { trail: TrailEvent[]; trailEarlier: number } {
  const events: TrailEvent[] = [
    ...approvals.map((at) => ({ kind: "approval" as const, at })),
    ...orders.map((at) => ({ kind: "order" as const, at })),
  ].sort((a, b) => (a.at === b.at ? (a.kind === "approval" ? -1 : 1) : a.at < b.at ? -1 : 1));
  // An approval was used when the very next event is an order.
  events.forEach((e, i) => {
    if (e.kind === "approval") e.unused = events[i + 1]?.kind !== "order";
  });
  const trailEarlier = Math.max(0, events.length - max);
  return { trail: events.slice(trailEarlier), trailEarlier };
}

/** Reject reason used for the hold case (also offered as a quick pick). */
export const NO_ORDER_REJECT_REASON = "No order after earlier approvals";

const MS_PER_DAY = 86_400_000;

function daysAgo(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / MS_PER_DAY));
}

/** "today" / "yesterday" / "12 days ago". */
export function agoLabel(iso: string, now: Date = new Date()): string {
  const d = daysAgo(iso, now);
  return d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

function times(n: number): string {
  return n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The verdict. Order of checks matters: "hold" and "watch" are about approvals
 * the shop did not use, so they win over a long-ago order history.
 */
export function reviewAccess(
  history: AccessHistory,
  now: Date = new Date(),
  policy: typeof ACCESS_REVIEW_POLICY = ACCESS_REVIEW_POLICY,
): AccessReview {
  const h = history;
  const facts: AccessFact[] = [];
  const unused = h.approvalsSinceLastOrder;
  const lastOrderRecent =
    h.lastOrderAt !== null && daysAgo(h.lastOrderAt, now) <= policy.recentDays;

  // ---- orders -------------------------------------------------------------
  if (h.ordersTotal === 0) {
    facts.push({
      label: "No orders yet",
      tone: h.approvalsTotal > 0 ? "destructive" : "neutral",
    });
  } else {
    facts.push({
      label: plural(h.ordersTotal, "order"),
      tone: "success",
    });
    if (h.lastOrderAt) {
      facts.push({
        label: `Last order ${agoLabel(h.lastOrderAt, now)}`,
        tone: lastOrderRecent ? "success" : "warning",
      });
    }
  }

  // ---- approvals ----------------------------------------------------------
  if (h.approvalsTotal > 0) {
    facts.push({
      label: `Approved ${times(h.approvalsTotal)}`,
      tone: "neutral",
    });
    if (unused > 0) {
      facts.push({
        label:
          h.ordersTotal === 0
            ? `${plural(unused, "approval")}, no order`
            : `${plural(unused, "approval")} since last order`,
        tone: unused >= policy.holdAfterUnusedApprovals ? "destructive" : "warning",
      });
    }
  }
  if (h.rejectionsTotal > 0) {
    facts.push({ label: `Rejected ${times(h.rejectionsTotal)} before`, tone: "neutral" });
  }
  if (h.viewsRecent > 0) {
    facts.push({
      label: `Saw ${plural(h.viewsRecent, "product")} in ${policy.recentDays} days`,
      tone: "neutral",
    });
  }
  if (h.cancelledTotal > 0) {
    facts.push({ label: `${plural(h.cancelledTotal, "cancelled order")}`, tone: "neutral" });
  }

  const base = { facts, history: h };
  const lastApproved = h.lastApprovedAt ? agoLabel(h.lastApprovedAt, now) : null;

  // ---- verdict ------------------------------------------------------------
  if (h.approvalsTotal === 0) {
    return {
      ...base,
      level: "new",
      headline:
        h.ordersTotal > 0
          ? "First request — but this shop has ordered before."
          : "New shop — asking for prices for the first time.",
      advice: null,
      suggestedRejectReason: null,
    };
  }

  if (unused >= policy.holdAfterUnusedApprovals) {
    return {
      ...base,
      level: "hold",
      headline:
        h.ordersTotal === 0
          ? `Approved ${times(unused)} already — never placed an order.`
          : `Approved ${times(unused)} since the last order — no order after any.`,
      advice: "Do not approve again. Reject, or call the shop first.",
      suggestedRejectReason: NO_ORDER_REJECT_REASON,
    };
  }

  if (unused >= policy.warnAfterUnusedApprovals) {
    return {
      ...base,
      level: "watch",
      headline:
        h.ordersTotal === 0
          ? `Approved once already${lastApproved ? ` (${lastApproved})` : ""} — no order after that.`
          : `Approved again after the last order — no order since.`,
      advice: "Approve only if you expect an order this time.",
      suggestedRejectReason: NO_ORDER_REJECT_REASON,
    };
  }

  // Ordered after every approval.
  return {
    ...base,
    level: "good",
    headline: lastOrderRecent
      ? `Regular buyer — last order ${agoLabel(h.lastOrderAt!, now)}.`
      : `Has ordered before, but no order in the last ${policy.recentDays} days.`,
    advice: null,
    suggestedRejectReason: null,
  };
}

/** Labels for the queue filter, keyed by level group. */
export const REVIEW_FILTERS = [
  { key: "all", label: "All" },
  { key: "good", label: "Ordered" },
  { key: "new", label: "New" },
  { key: "risky", label: "No order after approval" },
] as const;

export type ReviewFilterKey = (typeof REVIEW_FILTERS)[number]["key"];

export function matchesReviewFilter(
  level: AccessReviewLevel | undefined,
  filter: ReviewFilterKey,
): boolean {
  if (filter === "all") return true;
  if (filter === "risky") return level === "watch" || level === "hold";
  return level === filter;
}

/** Minimum length of the typed reason that unlocks a held approval. */
export const OVERRIDE_REASON_MIN = 5;

/** Message the server returns when a held approval arrives without a reason. */
export function holdMessage(review: AccessReview): string {
  return `${review.headline} Type a reason to approve anyway.`;
}

/** Short line for an admin push notification about this shop. */
export function reviewPushLine(review: AccessReview): string | null {
  switch (review.level) {
    case "hold":
    case "watch":
      return review.headline;
    case "good":
      return review.history.lastOrderAt
        ? `Last order ${agoLabel(review.history.lastOrderAt)}.`
        : null;
    default:
      return null;
  }
}
