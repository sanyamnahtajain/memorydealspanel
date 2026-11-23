import { describe, expect, it } from "vitest";

import {
  EMPTY_HISTORY,
  matchesReviewFilter,
  NO_ORDER_REJECT_REASON,
  reviewAccess,
  reviewPushLine,
  type AccessHistory,
} from "./access-review";

const NOW = new Date("2026-11-23T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const h = (over: Partial<AccessHistory>): AccessHistory => ({ ...EMPTY_HISTORY, ...over });
const labels = (r: ReturnType<typeof reviewAccess>) => r.facts.map((f) => f.label);

describe("reviewAccess — the owner's rule", () => {
  it("a brand-new shop is 'new', with nothing to warn about", () => {
    const r = reviewAccess(h({}), NOW);
    expect(r.level).toBe("new");
    expect(r.headline).toMatch(/first time/);
    expect(r.advice).toBeNull();
    expect(labels(r)).toEqual(["No orders yet"]);
    expect(r.facts[0]!.tone).toBe("neutral");
  });

  it("approved once, never ordered → 'watch' (approve with care)", () => {
    const r = reviewAccess(
      h({ approvalsTotal: 1, approvalsSinceLastOrder: 1, lastApprovedAt: ago(40), viewsRecent: 12 }),
      NOW,
    );
    expect(r.level).toBe("watch");
    expect(r.headline).toBe("Approved once already (40 days ago) — no order after that.");
    expect(r.suggestedRejectReason).toBe(NO_ORDER_REJECT_REASON);
    expect(labels(r)).toEqual([
      "No orders yet",
      "Approved once",
      "1 approval, no order",
      "Saw 12 products in 30 days",
    ]);
    expect(r.facts[0]!.tone).toBe("destructive");
  });

  it("approved twice, never ordered → 'hold' (Raghav: do not approve)", () => {
    const r = reviewAccess(h({ approvalsTotal: 2, approvalsSinceLastOrder: 2 }), NOW);
    expect(r.level).toBe("hold");
    expect(r.headline).toBe("Approved twice already — never placed an order.");
    expect(r.advice).toMatch(/Do not approve/);
    expect(r.facts.find((f) => f.label === "2 approvals, no order")?.tone).toBe("destructive");
  });

  it("ordered long ago, then approved twice with no order since → still 'hold'", () => {
    const r = reviewAccess(
      h({ ordersTotal: 3, lastOrderAt: ago(120), approvalsTotal: 4, approvalsSinceLastOrder: 2 }),
      NOW,
    );
    expect(r.level).toBe("hold");
    expect(r.headline).toBe("Approved twice since the last order — no order after any.");
    expect(labels(r)).toContain("Last order 120 days ago");
    expect(labels(r)).toContain("2 approvals since last order");
  });

  it("a regular buyer (ordered after the last approval, recently) is 'good'", () => {
    const r = reviewAccess(
      h({ ordersTotal: 8, ordersRecent: 2, lastOrderAt: ago(5), approvalsTotal: 1 }),
      NOW,
    );
    expect(r.level).toBe("good");
    expect(r.headline).toBe("Regular buyer — last order 5 days ago.");
    expect(r.facts.find((f) => f.label === "Last order 5 days ago")?.tone).toBe("success");
  });

  it("ordered before but nothing in 30 days → 'good', saying so plainly", () => {
    const r = reviewAccess(
      h({ ordersTotal: 2, lastOrderAt: ago(45), approvalsTotal: 1, approvalsSinceLastOrder: 0 }),
      NOW,
    );
    expect(r.level).toBe("good");
    expect(r.headline).toBe("Has ordered before, but no order in the last 30 days.");
    expect(r.facts.find((f) => f.label === "Last order 45 days ago")?.tone).toBe("warning");
  });

  it("a first request from a shop that already ordered (added by hand) is 'new' but says so", () => {
    const r = reviewAccess(h({ ordersTotal: 1, lastOrderAt: ago(2) }), NOW);
    expect(r.level).toBe("new");
    expect(r.headline).toMatch(/has ordered before/);
  });

  it("mentions cancellations and past rejections as context, never as the verdict", () => {
    const r = reviewAccess(h({ cancelledTotal: 2, rejectionsTotal: 1 }), NOW);
    expect(r.level).toBe("new");
    expect(labels(r)).toEqual(expect.arrayContaining(["2 cancelled orders", "Rejected once before"]));
  });
});

describe("queue filters", () => {
  it("'No order after approval' covers watch and hold only", () => {
    expect(matchesReviewFilter("hold", "risky")).toBe(true);
    expect(matchesReviewFilter("watch", "risky")).toBe(true);
    expect(matchesReviewFilter("good", "risky")).toBe(false);
    expect(matchesReviewFilter("new", "new")).toBe(true);
    expect(matchesReviewFilter(undefined, "all")).toBe(true);
  });
});

describe("reviewPushLine", () => {
  it("tells the admin on the lock screen when a shop never orders", () => {
    const r = reviewAccess(h({ approvalsTotal: 3, approvalsSinceLastOrder: 3 }), NOW);
    expect(reviewPushLine(r)).toBe("Approved 3 times already — never placed an order.");
    expect(reviewPushLine(reviewAccess(h({}), NOW))).toBeNull();
  });
});
