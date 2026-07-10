/**
 * Dashboard metrics service — read-only aggregations that feed the admin
 * dashboard charts.
 *
 * Every exported function is admin-guarded (`resolveViewer` + `assertAdmin`)
 * so a non-admin caller can never obtain admin-shaped analytics, and returns a
 * plain, serialisable shape (no `Date` objects, no Prisma types) safe to hand
 * to a client chart component.
 *
 * Aggregation strategy: rather than issuing one grouped query per calendar day
 * (30+ round-trips), each time-series metric does ONE bounded, index-backed
 * fetch of the rows in the window (selecting only the timestamp) and buckets
 * them in memory. The windows are small (≤30 days of low-cardinality events),
 * so the fetch stays cheap and the daily buckets are built in a single pass.
 */

import { assertAdmin } from "@/server/dal/guard";
import { resolveViewer } from "@/server/auth/viewer";
import { prisma } from "@/server/db";

const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Shared shapes                                                       */
/* ------------------------------------------------------------------ */

export interface TimeBucket {
  /** ISO date (YYYY-MM-DD) at day granularity, in UTC. */
  date: string;
  /** Short human label for the x-axis (e.g. "9 Jul"). */
  label: string;
  count: number;
}

export interface DualTimeBucket extends TimeBucket {
  /** Secondary count sharing the same day bucket. */
  countB: number;
}

export interface StatusSlice {
  status: string;
  count: number;
}

export interface NamedCount {
  id: string;
  name: string;
  /** Optional secondary identifier (SKU, etc.). */
  hint?: string;
  count: number;
}

export interface ExpiryBuckets {
  /** Grants expiring within 7 days (and still live). */
  next7: number;
  /** Grants expiring in 8–30 days. */
  next30: number;
}

/* ------------------------------------------------------------------ */
/* Date helpers                                                        */
/* ------------------------------------------------------------------ */

/** Start-of-day (UTC) for a date, as ms. Buckets are keyed on this. */
function dayKey(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const LABEL_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/**
 * Build an ordered array of empty daily buckets spanning the last `days`
 * (inclusive of today). Callers then increment `count` as they scan rows.
 */
function emptyDailyBuckets(days: number, now: Date): Map<number, TimeBucket> {
  const buckets = new Map<number, TimeBucket>();
  const todayKey = dayKey(now);
  for (let i = days - 1; i >= 0; i--) {
    const key = todayKey - i * DAY_MS;
    const date = new Date(key);
    buckets.set(key, {
      date: date.toISOString().slice(0, 10),
      label: LABEL_FMT.format(date),
      count: 0,
    });
  }
  return buckets;
}

/* ------------------------------------------------------------------ */
/* accessRequestsOverTime — daily new access requests, last 30 days    */
/* ------------------------------------------------------------------ */

export async function accessRequestsOverTime(days = 30): Promise<TimeBucket[]> {
  const viewer = await resolveViewer();
  assertAdmin(viewer);

  const now = new Date();
  const since = new Date(dayKey(now) - (days - 1) * DAY_MS);

  // Index-backed on {status, createdAt}; we only pull the timestamp.
  const rows = await prisma.accessRequest.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true },
  });

  const buckets = emptyDailyBuckets(days, now);
  for (const row of rows) {
    const bucket = buckets.get(dayKey(row.createdAt));
    if (bucket) bucket.count += 1;
  }
  return [...buckets.values()];
}

/* ------------------------------------------------------------------ */
/* approvalsVsRejections — decided requests per day, last 30 days      */
/* ------------------------------------------------------------------ */

export async function approvalsVsRejections(days = 30): Promise<DualTimeBucket[]> {
  const viewer = await resolveViewer();
  assertAdmin(viewer);

  const now = new Date();
  const since = new Date(dayKey(now) - (days - 1) * DAY_MS);

  const rows = await prisma.accessRequest.findMany({
    where: {
      decidedAt: { gte: since },
      status: { in: ["APPROVED", "REJECTED"] },
    },
    select: { decidedAt: true, status: true },
  });

  const base = emptyDailyBuckets(days, now);
  const buckets = new Map<number, DualTimeBucket>();
  for (const [key, b] of base) buckets.set(key, { ...b, countB: 0 });

  for (const row of rows) {
    if (!row.decidedAt) continue;
    const bucket = buckets.get(dayKey(row.decidedAt));
    if (!bucket) continue;
    if (row.status === "APPROVED") bucket.count += 1;
    else bucket.countB += 1;
  }
  return [...buckets.values()];
}

/* ------------------------------------------------------------------ */
/* customersByStatus — count per CustomerStatus                        */
/* ------------------------------------------------------------------ */

/** Fixed order so slice colors stay stable across renders. */
const CUSTOMER_STATUSES = [
  "APPROVED",
  "PENDING",
  "REJECTED",
  "EXPIRED",
  "BLOCKED",
] as const;

export async function customersByStatus(): Promise<StatusSlice[]> {
  const viewer = await resolveViewer();
  assertAdmin(viewer);

  // groupBy is index-backed on {status}; low cardinality (5 buckets).
  const grouped = await prisma.customer.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  const byStatus = new Map(grouped.map((g) => [g.status, g._count._all]));
  return CUSTOMER_STATUSES.map((status) => ({
    status,
    count: byStatus.get(status) ?? 0,
  }));
}

/* ------------------------------------------------------------------ */
/* mostViewedProducts — top N by PageView, last 30 days                */
/* ------------------------------------------------------------------ */

export async function mostViewedProducts(
  take = 8,
  days = 30,
): Promise<NamedCount[]> {
  const viewer = await resolveViewer();
  assertAdmin(viewer);

  const since = new Date(Date.now() - days * DAY_MS);

  // Index-backed groupBy on PageView.{productId, createdAt}, top N by count.
  const grouped = await prisma.pageView.groupBy({
    by: ["productId"],
    where: { createdAt: { gte: since } },
    _count: { productId: true },
    orderBy: { _count: { productId: "desc" } },
    take,
  });

  const ids = grouped.map((g) => g.productId);
  if (ids.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, sku: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  return grouped
    .map((g): NamedCount | null => {
      const product = byId.get(g.productId);
      if (!product) return null;
      return {
        id: product.id,
        name: product.name,
        hint: product.sku,
        count: g._count.productId,
      };
    })
    .filter((x): x is NamedCount => x !== null);
}

/* ------------------------------------------------------------------ */
/* accessesExpiringSoon — live grants bucketed into 7 / 30 day windows */
/* ------------------------------------------------------------------ */

export async function accessesExpiringSoon(): Promise<ExpiryBuckets> {
  const viewer = await resolveViewer();
  assertAdmin(viewer);

  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * DAY_MS);
  const in30 = new Date(now.getTime() + 30 * DAY_MS);

  // Two counts over the same index ({customerId, expiresAt}); cheap.
  const [next7, next30] = await Promise.all([
    prisma.accessGrant.count({
      where: { revokedAt: null, expiresAt: { gt: now, lte: in7 } },
    }),
    prisma.accessGrant.count({
      where: { revokedAt: null, expiresAt: { gt: in7, lte: in30 } },
    }),
  ]);

  return { next7, next30 };
}

/* ------------------------------------------------------------------ */
/* catalogGrowth — products created per day, last N days               */
/* ------------------------------------------------------------------ */

export async function catalogGrowth(days = 30): Promise<TimeBucket[]> {
  const viewer = await resolveViewer();
  assertAdmin(viewer);

  const now = new Date();
  const since = new Date(dayKey(now) - (days - 1) * DAY_MS);

  // Non-deleted products created within the window; index on {..,createdAt}.
  const rows = await prisma.product.findMany({
    where: { deletedAt: null, createdAt: { gte: since } },
    select: { createdAt: true },
  });

  const buckets = emptyDailyBuckets(days, now);
  for (const row of rows) {
    const bucket = buckets.get(dayKey(row.createdAt));
    if (bucket) bucket.count += 1;
  }
  return [...buckets.values()];
}

/* ------------------------------------------------------------------ */
/* Bundled loader — one call for the dashboard charts section          */
/* ------------------------------------------------------------------ */

export interface DashboardCharts {
  accessRequests: TimeBucket[];
  decisions: DualTimeBucket[];
  customers: StatusSlice[];
  mostViewed: NamedCount[];
  expiring: ExpiryBuckets;
  catalog: TimeBucket[];
}

/**
 * Resolve every chart dataset for the dashboard in parallel. Each inner call
 * re-asserts admin (defence in depth) but shares the single request-scoped
 * viewer lookup via React cache upstream.
 */
export async function getDashboardCharts(): Promise<DashboardCharts> {
  const viewer = await resolveViewer();
  assertAdmin(viewer);

  const [accessRequests, decisions, customers, mostViewed, expiring, catalog] =
    await Promise.all([
      accessRequestsOverTime(30),
      approvalsVsRejections(30),
      customersByStatus(),
      mostViewedProducts(8, 30),
      accessesExpiringSoon(),
      catalogGrowth(30),
    ]);

  return { accessRequests, decisions, customers, mostViewed, expiring, catalog };
}
