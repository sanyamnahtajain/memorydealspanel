import { describe, expect, it } from "vitest";

import {
  computeCalendarPeriods,
  computeMoneyByGroup,
  computePeriodTotals,
  computeRhythm,
  computeTopCustomers,
  computeTradeSummary,
  shopCalendar,
  type OrderRow,
} from "./dashboard-insights";

/**
 * The insights are pure functions over a slice of order rows; these tests
 * pin the arithmetic (cancelled excluded, new vs returning, "Other" folding,
 * IST calendar boundaries) without a database.
 */

const H = 3_600_000;
const D = 24 * H;

function order(over: Partial<OrderRow> & { placedAt: Date }): OrderRow {
  return {
    customerId: "c1",
    status: "PLACED",
    fulfilledAt: null,
    subtotalPaise: 100_000,
    items: [],
    ...over,
  };
}

describe("computePeriodTotals", () => {
  it("excludes cancelled orders from count, value and buyers", () => {
    const now = new Date();
    const t = computePeriodTotals([
      order({ placedAt: now, subtotalPaise: 100_000 }),
      order({ placedAt: now, subtotalPaise: 50_000, customerId: "c2", status: "FULFILLED" }),
      order({ placedAt: now, subtotalPaise: 999_999, customerId: "c3", status: "CANCELLED" }),
    ]);
    expect(t).toEqual({ orders: 2, valuePaise: 150_000, avgOrderPaise: 75_000, buyers: 2, cancelled: 1, fulfilled: 1 });
  });
});

describe("computeTradeSummary", () => {
  it("splits buyers into new and returning by their first-ever order, and times fulfilment", () => {
    const now = new Date("2026-10-16T10:00:00Z");
    const current = [
      order({ placedAt: new Date(now.getTime() - 2 * D), customerId: "new1" }),
      order({ placedAt: new Date(now.getTime() - 3 * D), customerId: "old1", status: "FULFILLED", fulfilledAt: new Date(now.getTime() - 2 * D) }),
      order({ placedAt: new Date(now.getTime() - 1 * D), customerId: "old1", status: "CONFIRMED" }),
    ];
    const previous = [order({ placedAt: new Date(now.getTime() - 40 * D), customerId: "old1" })];
    const first = new Map([
      ["new1", new Date(now.getTime() - 2 * D)],
      ["old1", new Date(now.getTime() - 400 * D)],
    ]);
    const s = computeTradeSummary(30, current, previous, first, now);
    expect(s.newBuyers).toBe(1);
    expect(s.returningBuyers).toBe(1);
    expect(s.toConfirm).toBe(1);
    expect(s.inProgress).toBe(1);
    expect(s.avgFulfilmentHours).toBe(24);
    expect(s.previous.orders).toBe(1);
  });
});

describe("shop calendar (IST)", () => {
  it("today starts at IST midnight, the week on Monday, the month on the 1st", () => {
    // Thursday 16 Oct 2026, 10:00 UTC = 15:30 IST.
    const now = new Date("2026-10-16T10:00:00Z");
    const c = shopCalendar(now);
    expect(c.today.toISOString()).toBe("2026-10-15T18:30:00.000Z"); // 16 Oct 00:00 IST
    expect(c.weekStart.toISOString()).toBe("2026-10-11T18:30:00.000Z"); // Mon 12 Oct 00:00 IST
    expect(c.monthStart.toISOString()).toBe("2026-09-30T18:30:00.000Z"); // 1 Oct 00:00 IST
    expect(c.lastMonthStart.toISOString()).toBe("2026-08-31T18:30:00.000Z"); // 1 Sep 00:00 IST
  });

  it("an order at 00:30 IST counts as today even though it is still yesterday in UTC", () => {
    const now = new Date("2026-10-16T10:00:00Z");
    const rows = [
      order({ placedAt: new Date("2026-10-15T19:00:00Z"), subtotalPaise: 1 }), // 00:30 IST today
      order({ placedAt: new Date("2026-10-15T18:00:00Z"), subtotalPaise: 10 }), // 23:30 IST yesterday
      order({ placedAt: new Date("2026-09-20T05:00:00Z"), subtotalPaise: 100 }), // last month
      order({ placedAt: new Date("2026-09-10T05:00:00Z"), subtotalPaise: 1000, status: "CANCELLED" }),
    ];
    const p = computeCalendarPeriods(rows, now);
    expect(p.today).toEqual({ orders: 1, valuePaise: 1 });
    expect(p.yesterday).toEqual({ orders: 1, valuePaise: 10 });
    expect(p.thisMonth).toEqual({ orders: 2, valuePaise: 11 });
    expect(p.lastMonth).toEqual({ orders: 1, valuePaise: 100 });
    // 20 Sep is after "16 Sep same time", so last-month-to-date excludes it.
    expect(p.lastMonthToDate).toEqual({ orders: 0, valuePaise: 0 });
  });
});

describe("computeMoneyByGroup", () => {
  it("sums line totals per group and folds the tail into Other at k", () => {
    const now = new Date();
    const rows = [
      order({
        placedAt: now,
        items: [
          { productId: "a", quantity: 2, lineTotalPaise: 500 },
          { productId: "b", quantity: 1, lineTotalPaise: 400 },
          { productId: "c", quantity: 1, lineTotalPaise: 300 },
          { productId: "d", quantity: 1, lineTotalPaise: 200 },
          { productId: "junk" }, // malformed line — ignored
        ],
      }),
      order({ placedAt: now, status: "CANCELLED", items: [{ productId: "a", quantity: 9, lineTotalPaise: 9_999 }] }),
    ];
    const groups = computeMoneyByGroup(rows, (l) => (typeof l.productId === "string" ? { id: l.productId, name: l.productId.toUpperCase() } : null), 3);
    expect(groups.map((g) => [g.id, g.valuePaise, g.count])).toEqual([
      ["a", 500, 2],
      ["b", 400, 1],
      ["other", 500, 2],
    ]);
  });
});

describe("computeTopCustomers / computeRhythm", () => {
  it("ranks customers by value and buckets hours in IST", () => {
    const rows = [
      order({ placedAt: new Date("2026-10-16T03:30:00Z"), customerId: "x", subtotalPaise: 10 }), // 09:00 IST Fri
      order({ placedAt: new Date("2026-10-16T03:45:00Z"), customerId: "y", subtotalPaise: 30 }), // 09:15 IST Fri
      order({ placedAt: new Date("2026-10-18T18:40:00Z"), customerId: "y", subtotalPaise: 5 }), // 00:10 IST Mon
    ];
    const top = computeTopCustomers(rows, new Map([["y", { businessName: "Y Traders", city: "Delhi" }]]), 5);
    expect(top[0]).toMatchObject({ id: "y", name: "Y Traders", hint: "Delhi", valuePaise: 35, count: 2 });
    expect(top[1]).toMatchObject({ id: "x", name: "Customer", valuePaise: 10 });
    const r = computeRhythm(rows);
    expect(r.byHour[9]).toBe(2);
    expect(r.byHour[0]).toBe(1);
    expect(r.byWeekday[4]).toBe(2); // Friday
    expect(r.byWeekday[0]).toBe(1); // Monday
  });
});
