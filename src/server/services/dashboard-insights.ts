/**
 * Dashboard insights — the business read of the trade: money by period with
 * a comparison, who buys, what sells by category and brand, when retailers
 * order, the view-to-order funnel, stock health, and the access funnel.
 *
 * Shape of this module (mirrors dashboard-metrics.ts):
 *  - every exported loader is admin-guarded (`getViewer` + `assertAdmin`);
 *  - ONE bounded read of the window's orders (and the previous window's, for
 *    the comparison) feeds every order-derived insight through PURE compute
 *    functions — exported so they are unit-tested without a database;
 *  - results are plain, serialisable objects: money is integer paise, dates
 *    are ISO strings, nothing Prisma-typed crosses to a component.
 */

import { assertAdmin } from "@/server/dal/guard";
import { getViewer } from "@/server/auth/viewer";
import { prisma } from "@/server/db";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The shop trades in India; "when do retailers order" is asked in IST. */
const SHOP_TIME_ZONE = "Asia/Kolkata";

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

/** The slice of an order every insight here needs. */
export interface OrderRow {
  customerId: string;
  status: string;
  placedAt: Date;
  fulfilledAt: Date | null;
  subtotalPaise: number;
  items: unknown;
}

interface SnapshotLine {
  productId?: string;
  name?: string;
  brand?: string | null;
  quantity?: number;
  lineTotalPaise?: number;
}

export interface PeriodTotals {
  orders: number;
  valuePaise: number;
  /** Average order value, integer paise (0 when no orders). */
  avgOrderPaise: number;
  /** Distinct customers who placed a (non-cancelled) order. */
  buyers: number;
  cancelled: number;
  fulfilled: number;
}

/** A calendar-period headline: non-cancelled orders and their value. */
export interface PeriodFigure {
  orders: number;
  valuePaise: number;
}

/** The numbers an owner asks for by name, all on the shop's calendar (IST). */
export interface CalendarPeriods {
  today: PeriodFigure;
  yesterday: PeriodFigure;
  /** Monday to now. */
  thisWeek: PeriodFigure;
  /** The same weekday span of the previous week (Monday to the same moment). */
  lastWeekToDate: PeriodFigure;
  /** 1st of the month to now. */
  thisMonth: PeriodFigure;
  /** The whole of the previous calendar month. */
  lastMonth: PeriodFigure;
  /** The previous month up to the same day-of-month as today (fair comparison). */
  lastMonthToDate: PeriodFigure;
}

export interface TradeSummary {
  days: number;
  current: PeriodTotals;
  previous: PeriodTotals;
  periods: CalendarPeriods;
  /** Buyers in the window whose FIRST ever order is inside the window. */
  newBuyers: number;
  /** Buyers in the window who had ordered before it. */
  returningBuyers: number;
  /** Orders waiting for staff: PLACED (to confirm) and in progress. */
  toConfirm: number;
  inProgress: number;
  /** Mean hours from placement to fulfilment for orders fulfilled in-window. */
  avgFulfilmentHours: number | null;
}

export interface MoneyShare {
  id: string;
  name: string;
  valuePaise: number;
  /** Secondary count — orders for a customer, units for a group. */
  count: number;
  hint?: string;
}

export interface Rhythm {
  /** 24 entries, IST hour of day → orders. */
  byHour: number[];
  /** 7 entries, Monday → Sunday, orders. */
  byWeekday: number[];
}

export interface DemandFunnel {
  views: number;
  cartAdds: number;
  orders: number;
  fulfilled: number;
}

export interface StockHealth {
  inStock: number;
  low: number;
  outOfStock: number;
  /** Products retailers ordered in the window that are now LOW/OUT: demand at risk. */
  atRisk: { id: string; name: string; sku: string; stockStatus: string; units: number }[];
}

export interface AccessFunnel {
  requested: number;
  approved: number;
  rejected: number;
  pending: number;
  /** Mean hours from request to decision, decided in-window. */
  avgDecisionHours: number | null;
}

export interface DashboardInsights {
  days: number;
  trade: TradeSummary;
  topCustomers: MoneyShare[];
  byCategory: MoneyShare[];
  byBrand: MoneyShare[];
  rhythm: Rhythm;
  funnel: DemandFunnel;
  viewedNotOrdered: { id: string; name: string; sku: string; views: number }[];
  stock: StockHealth;
  byCity: { city: string; count: number }[];
  access: AccessFunnel;
}

/* ------------------------------------------------------------------ */
/* Pure compute — exported for tests                                   */
/* ------------------------------------------------------------------ */

const isCancelled = (o: OrderRow) => o.status === "CANCELLED";

function lines(items: unknown): SnapshotLine[] {
  if (!Array.isArray(items)) return [];
  return items.filter((x): x is SnapshotLine => !!x && typeof x === "object");
}

export function computePeriodTotals(rows: OrderRow[]): PeriodTotals {
  let orders = 0;
  let valuePaise = 0;
  let cancelled = 0;
  let fulfilled = 0;
  const buyers = new Set<string>();
  for (const row of rows) {
    if (isCancelled(row)) {
      cancelled += 1;
      continue;
    }
    orders += 1;
    valuePaise += row.subtotalPaise;
    buyers.add(row.customerId);
    if (row.status === "FULFILLED") fulfilled += 1;
  }
  return {
    orders,
    valuePaise,
    avgOrderPaise: orders > 0 ? Math.round(valuePaise / orders) : 0,
    buyers: buyers.size,
    cancelled,
    fulfilled,
  };
}

/** Calendar fields of an instant in the shop's time zone. */
function shopParts(at: Date): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = WEEKDAYS.indexOf(get("weekday")); // Mon = 0
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), weekday: weekday < 0 ? 0 : weekday };
}

/** Midnight (shop time) of the given shop-calendar date, as an instant. */
function shopMidnight(year: number, month: number, day: number): Date {
  // IST has no DST: a fixed +05:30 offset makes this exact.
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - 5.5 * 3_600_000);
}

/** The calendar boundaries every headline period needs, from one `now`. */
export function shopCalendar(now: Date) {
  const { year, month, day, weekday } = shopParts(now);
  const today = shopMidnight(year, month, day);
  const yesterday = new Date(today.getTime() - DAY_MS);
  const weekStart = new Date(today.getTime() - weekday * DAY_MS);
  const lastWeekStart = new Date(weekStart.getTime() - 7 * DAY_MS);
  const monthStart = shopMidnight(year, month, 1);
  const lastMonthStart = month === 1 ? shopMidnight(year - 1, 12, 1) : shopMidnight(year, month - 1, 1);
  const sameMomentLastWeek = new Date(now.getTime() - 7 * DAY_MS);
  // "Last month to date": the same day-of-month, clamped to that month's length.
  const lastMonthDays = Math.round((monthStart.getTime() - lastMonthStart.getTime()) / DAY_MS);
  const lastMonthToDateEnd = new Date(
    lastMonthStart.getTime() + (Math.min(day, lastMonthDays) - 1) * DAY_MS + (now.getTime() - today.getTime()),
  );
  return { today, yesterday, weekStart, lastWeekStart, sameMomentLastWeek, monthStart, lastMonthStart, lastMonthToDateEnd };
}

function figure(rows: OrderRow[], from: Date, to: Date): PeriodFigure {
  let orders = 0;
  let valuePaise = 0;
  for (const o of rows) {
    if (isCancelled(o)) continue;
    if (o.placedAt >= from && o.placedAt < to) {
      orders += 1;
      valuePaise += o.subtotalPaise;
    }
  }
  return { orders, valuePaise };
}

/** Today / this week / this month and their comparisons, from one row set. */
export function computeCalendarPeriods(rows: OrderRow[], now: Date): CalendarPeriods {
  const c = shopCalendar(now);
  const end = new Date(now.getTime() + 60_000);
  return {
    today: figure(rows, c.today, end),
    yesterday: figure(rows, c.yesterday, c.today),
    thisWeek: figure(rows, c.weekStart, end),
    lastWeekToDate: figure(rows, c.lastWeekStart, c.sameMomentLastWeek),
    thisMonth: figure(rows, c.monthStart, end),
    lastMonth: figure(rows, c.lastMonthStart, c.monthStart),
    lastMonthToDate: figure(rows, c.lastMonthStart, c.lastMonthToDateEnd),
  };
}

export function computeTradeSummary(
  days: number,
  current: OrderRow[],
  previous: OrderRow[],
  /** customerId → first-ever order instant (for buyers seen in `current`). */
  firstOrderAt: Map<string, Date>,
  now: Date,
  /** Rows since the start of last month — the calendar headlines' source. */
  history: OrderRow[] = current,
): TradeSummary {
  const cur = computePeriodTotals(current);
  const prev = computePeriodTotals(previous);
  const since = new Date(now.getTime() - days * DAY_MS);

  const buyers = new Set(current.filter((o) => !isCancelled(o)).map((o) => o.customerId));
  let newBuyers = 0;
  for (const id of buyers) {
    const first = firstOrderAt.get(id);
    if (first && first >= since) newBuyers += 1;
  }

  let toConfirm = 0;
  let inProgress = 0;
  let fulfilHours = 0;
  let fulfilCount = 0;
  for (const o of current) {
    if (isCancelled(o)) continue;
    if (o.status === "PLACED") toConfirm += 1;
    else if (o.status === "CONFIRMED" || o.status === "PROCESSING" || o.status === "DISPATCHED") {
      inProgress += 1;
    }
    if (o.status === "FULFILLED" && o.fulfilledAt && o.fulfilledAt >= o.placedAt) {
      fulfilHours += (o.fulfilledAt.getTime() - o.placedAt.getTime()) / 3_600_000;
      fulfilCount += 1;
    }
  }

  return {
    days,
    current: cur,
    previous: prev,
    periods: computeCalendarPeriods(history, now),
    newBuyers,
    returningBuyers: buyers.size - newBuyers,
    toConfirm,
    inProgress,
    avgFulfilmentHours: fulfilCount > 0 ? Math.round((fulfilHours / fulfilCount) * 10) / 10 : null,
  };
}

/** Top customers by ordered value in the window (non-cancelled). */
export function computeTopCustomers(
  rows: OrderRow[],
  names: Map<string, { businessName: string; city: string | null }>,
  k: number,
): MoneyShare[] {
  const acc = new Map<string, { valuePaise: number; orders: number }>();
  for (const o of rows) {
    if (isCancelled(o)) continue;
    const slot = acc.get(o.customerId) ?? { valuePaise: 0, orders: 0 };
    slot.valuePaise += o.subtotalPaise;
    slot.orders += 1;
    acc.set(o.customerId, slot);
  }
  return [...acc.entries()]
    .map(([id, v]) => {
      const who = names.get(id);
      return {
        id,
        name: who?.businessName ?? "Customer",
        hint: who?.city ?? undefined,
        valuePaise: v.valuePaise,
        count: v.orders,
      };
    })
    .sort((a, b) => b.valuePaise - a.valuePaise)
    .slice(0, k);
}

/**
 * Money per group from the frozen line snapshots. `groupOf` names the group
 * for a line (category via the product lookup, brand from the snapshot).
 * The top `k` are kept and the rest folded into "Other" — never a ninth hue.
 */
export function computeMoneyByGroup(
  rows: OrderRow[],
  groupOf: (line: SnapshotLine) => { id: string; name: string } | null,
  k: number,
): MoneyShare[] {
  const acc = new Map<string, MoneyShare>();
  for (const o of rows) {
    if (isCancelled(o)) continue;
    for (const line of lines(o.items)) {
      const value = typeof line.lineTotalPaise === "number" ? line.lineTotalPaise : 0;
      const units = typeof line.quantity === "number" ? line.quantity : 0;
      const group = groupOf(line);
      if (!group || value <= 0) continue;
      const slot = acc.get(group.id) ?? { id: group.id, name: group.name, valuePaise: 0, count: 0 };
      slot.valuePaise += value;
      slot.count += units;
      acc.set(group.id, slot);
    }
  }
  const sorted = [...acc.values()].sort((a, b) => b.valuePaise - a.valuePaise);
  if (sorted.length <= k) return sorted;
  const head = sorted.slice(0, k - 1);
  const tail = sorted.slice(k - 1);
  head.push({
    id: "other",
    name: "Other",
    valuePaise: tail.reduce((s, x) => s + x.valuePaise, 0),
    count: tail.reduce((s, x) => s + x.count, 0),
  });
  return head;
}

/** Units per productId in the window (non-cancelled). */
export function computeUnitsByProduct(rows: OrderRow[]): Map<string, number> {
  const units = new Map<string, number>();
  for (const o of rows) {
    if (isCancelled(o)) continue;
    for (const line of lines(o.items)) {
      if (typeof line.productId !== "string" || typeof line.quantity !== "number") continue;
      units.set(line.productId, (units.get(line.productId) ?? 0) + line.quantity);
    }
  }
  return units;
}

const HOUR_FMT = new Intl.DateTimeFormat("en-GB", { timeZone: SHOP_TIME_ZONE, hour: "numeric", hour12: false });
const WEEKDAY_FMT = new Intl.DateTimeFormat("en-GB", { timeZone: SHOP_TIME_ZONE, weekday: "short" });
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** When retailers order: by IST hour and by weekday (non-cancelled). */
export function computeRhythm(rows: OrderRow[]): Rhythm {
  const byHour = new Array<number>(24).fill(0);
  const byWeekday = new Array<number>(7).fill(0);
  for (const o of rows) {
    if (isCancelled(o)) continue;
    const hour = Number(HOUR_FMT.format(o.placedAt)) % 24;
    byHour[hour] += 1;
    const wd = WEEKDAYS.indexOf(WEEKDAY_FMT.format(o.placedAt));
    if (wd >= 0) byWeekday[wd] += 1;
  }
  return { byHour, byWeekday };
}

/* ------------------------------------------------------------------ */
/* Loaders                                                             */
/* ------------------------------------------------------------------ */

const ORDER_SELECT = {
  customerId: true,
  status: true,
  placedAt: true,
  fulfilledAt: true,
  subtotalPaise: true,
  items: true,
} as const;

async function loadOrders(from: Date, to: Date): Promise<OrderRow[]> {
  // Index-backed on placedAt; the window is days, not history.
  return prisma.order.findMany({
    where: { placedAt: { gte: from, lt: to } },
    select: ORDER_SELECT,
  });
}

/**
 * Everything the insights section renders, resolved from one read of the
 * current window and one of the previous window, plus a handful of small
 * index-backed lookups. Re-asserts admin (defence in depth).
 */
export async function getDashboardInsights(days = 30, k = 8): Promise<DashboardInsights> {
  const viewer = await getViewer();
  assertAdmin(viewer);

  const now = new Date();
  const since = new Date(now.getTime() - days * DAY_MS);
  const prevSince = new Date(since.getTime() - days * DAY_MS);

  // ONE read covers the comparison window AND the calendar headlines (today,
  // this week, this month, last month): everything since whichever is older.
  const calendar = shopCalendar(now);
  const from = new Date(Math.min(prevSince.getTime(), calendar.lastMonthStart.getTime()));
  const history = await loadOrders(from, new Date(now.getTime() + 60_000));
  const current = history.filter((o) => o.placedAt >= since);
  const previous = history.filter((o) => o.placedAt >= prevSince && o.placedAt < since);

  // ---- customers: first-ever order (new vs returning) + names/cities ----
  const buyerIds = [...new Set(current.filter((o) => !isCancelled(o)).map((o) => o.customerId))];
  const [firstOrders, customers] = await Promise.all([
    buyerIds.length
      ? prisma.order.groupBy({
          by: ["customerId"],
          where: { customerId: { in: buyerIds }, status: { not: "CANCELLED" } },
          _min: { placedAt: true },
        })
      : Promise.resolve([]),
    buyerIds.length
      ? prisma.customer.findMany({
          where: { id: { in: buyerIds } },
          select: { id: true, businessName: true, city: true },
        })
      : Promise.resolve([]),
  ]);
  const firstOrderAt = new Map<string, Date>();
  for (const g of firstOrders) if (g._min.placedAt) firstOrderAt.set(g.customerId, g._min.placedAt);
  const names = new Map(customers.map((c) => [c.id, { businessName: c.businessName, city: c.city ?? null }]));

  const trade = computeTradeSummary(days, current, previous, firstOrderAt, now, history);
  const topCustomers = computeTopCustomers(current, names, k);

  // ---- category / brand money from the frozen lines ----
  const unitsByProduct = computeUnitsByProduct(current);
  const productIds = [...unitsByProduct.keys()].filter((id) => /^[0-9a-f]{24}$/i.test(id));
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          name: true,
          sku: true,
          stockStatus: true,
          category: { select: { id: true, name: true } },
          brandRef: { select: { id: true, name: true } },
        },
      })
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  const byCategory = computeMoneyByGroup(
    current,
    (line) => {
      const p = typeof line.productId === "string" ? productById.get(line.productId) : undefined;
      return p ? { id: p.category.id, name: p.category.name } : null;
    },
    k,
  );
  const byBrand = computeMoneyByGroup(
    current,
    (line) => {
      const p = typeof line.productId === "string" ? productById.get(line.productId) : undefined;
      if (p?.brandRef) return { id: p.brandRef.id, name: p.brandRef.name };
      if (typeof line.brand === "string" && line.brand.trim()) {
        return { id: `legacy:${line.brand.trim().toLowerCase()}`, name: line.brand.trim() };
      }
      return null;
    },
    k,
  );

  const rhythm = computeRhythm(current);

  // ---- demand funnel + viewed-but-not-ordered ----
  const [views, cartAdds, viewedGroups, stockCounts, cityGroups, requests, decided, pendingRequests] =
    await Promise.all([
      prisma.pageView.count({ where: { createdAt: { gte: since } } }),
      prisma.cartItem.count({ where: { createdAt: { gte: since } } }),
      prisma.pageView.groupBy({
        by: ["productId"],
        where: { createdAt: { gte: since } },
        _count: { productId: true },
        orderBy: { _count: { productId: "desc" } },
        take: 40,
      }),
      prisma.product.groupBy({
        by: ["stockStatus"],
        where: { deletedAt: null, status: "ACTIVE" },
        _count: { _all: true },
      }),
      prisma.customer.groupBy({
        by: ["city"],
        where: { status: "APPROVED", city: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { city: "desc" } },
        take: k,
      }),
      prisma.accessRequest.count({ where: { createdAt: { gte: since } } }),
      prisma.accessRequest.findMany({
        where: { decidedAt: { gte: since }, status: { in: ["APPROVED", "REJECTED"] } },
        select: { status: true, createdAt: true, decidedAt: true },
      }),
      prisma.accessRequest.count({ where: { status: "PENDING" } }),
    ]);

  const funnel: DemandFunnel = {
    views,
    cartAdds,
    orders: trade.current.orders,
    fulfilled: trade.current.fulfilled,
  };

  const notOrderedIds = viewedGroups
    .filter((g) => !unitsByProduct.has(g.productId))
    .slice(0, 6);
  const notOrderedProducts = notOrderedIds.length
    ? await prisma.product.findMany({
        where: { id: { in: notOrderedIds.map((g) => g.productId) }, deletedAt: null },
        select: { id: true, name: true, sku: true },
      })
    : [];
  const notOrderedById = new Map(notOrderedProducts.map((p) => [p.id, p]));
  const viewedNotOrdered = notOrderedIds
    .map((g) => {
      const p = notOrderedById.get(g.productId);
      return p ? { id: p.id, name: p.name, sku: p.sku, views: g._count.productId } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const stockBy = new Map(stockCounts.map((g) => [g.stockStatus, g._count._all]));
  const atRisk = products
    .filter((p) => p.stockStatus !== "IN_STOCK")
    .map((p) => ({ id: p.id, name: p.name, sku: p.sku, stockStatus: p.stockStatus, units: unitsByProduct.get(p.id) ?? 0 }))
    .sort((a, b) => b.units - a.units)
    .slice(0, 6);
  const stock: StockHealth = {
    inStock: stockBy.get("IN_STOCK") ?? 0,
    low: stockBy.get("LOW") ?? 0,
    outOfStock: stockBy.get("OUT_OF_STOCK") ?? 0,
    atRisk,
  };

  const byCity = cityGroups
    .filter((g): g is typeof g & { city: string } => typeof g.city === "string" && g.city.trim() !== "")
    .map((g) => ({ city: g.city, count: g._count._all }));

  let decisionHours = 0;
  let decisionCount = 0;
  let approved = 0;
  let rejected = 0;
  for (const r of decided) {
    if (r.status === "APPROVED") approved += 1;
    else rejected += 1;
    if (r.decidedAt && r.decidedAt >= r.createdAt) {
      decisionHours += (r.decidedAt.getTime() - r.createdAt.getTime()) / 3_600_000;
      decisionCount += 1;
    }
  }
  const access: AccessFunnel = {
    requested: requests,
    approved,
    rejected,
    pending: pendingRequests,
    avgDecisionHours: decisionCount > 0 ? Math.round((decisionHours / decisionCount) * 10) / 10 : null,
  };

  return { days, trade, topCustomers, byCategory, byBrand, rhythm, funnel, viewedNotOrdered, stock, byCity, access };
}
