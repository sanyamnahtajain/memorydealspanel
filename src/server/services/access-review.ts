import { prisma } from "@/server/db";
import {
  ACCESS_REVIEW_POLICY,
  buildTrail,
  EMPTY_HISTORY,
  reviewAccess,
  type AccessHistory,
  type AccessReview,
} from "@/lib/access-review";

/**
 * Build the approval review (see `src/lib/access-review.ts`) for MANY
 * customers in a fixed number of queries — the request queue can hold 100+
 * open requests, so this must never be one query per customer.
 *
 * Five queries, all on indexed fields, regardless of how many ids:
 *   orders per status (count + latest placedAt) · recent orders · grants ·
 *   rejections · recent product views.
 */
export async function getAccessReviews(
  customerIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, AccessReview>> {
  const ids = [...new Set(customerIds)].filter(Boolean);
  const out = new Map<string, AccessReview>();
  if (ids.length === 0) return out;

  const since = new Date(now.getTime() - ACCESS_REVIEW_POLICY.recentDays * 86_400_000);

  // The trail only needs the recent past; a year is far more than six points.
  const trailSince = new Date(now.getTime() - 365 * 86_400_000);

  const [ordersByStatus, recentOrders, grants, rejections, views, orderDates] = await Promise.all([
    prisma.order.groupBy({
      by: ["customerId", "status"],
      where: { customerId: { in: ids } },
      _count: { _all: true },
      _max: { placedAt: true },
    }),
    prisma.order.groupBy({
      by: ["customerId"],
      where: { customerId: { in: ids }, status: { not: "CANCELLED" }, placedAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.accessGrant.findMany({
      where: { customerId: { in: ids } },
      select: { customerId: true, approvedAt: true, grantedBy: true },
    }),
    prisma.accessRequest.groupBy({
      by: ["customerId"],
      where: { customerId: { in: ids }, status: "REJECTED" },
      _count: { _all: true },
    }),
    prisma.pageView.groupBy({
      by: ["customerId"],
      where: { customerId: { in: ids }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.order.findMany({
      where: { customerId: { in: ids }, status: { not: "CANCELLED" }, placedAt: { gte: trailSince } },
      select: { customerId: true, placedAt: true },
    }),
  ]);

  const hist = new Map<string, AccessHistory>();
  const get = (id: string): AccessHistory => {
    let h = hist.get(id);
    if (!h) {
      h = { ...EMPTY_HISTORY };
      hist.set(id, h);
    }
    return h;
  };

  for (const row of ordersByStatus) {
    const h = get(row.customerId);
    const count = row._count._all;
    if (row.status === "CANCELLED") {
      h.cancelledTotal += count;
      continue;
    }
    h.ordersTotal += count;
    const latest = row._max.placedAt;
    if (latest && (!h.lastOrderAt || latest.toISOString() > h.lastOrderAt)) {
      h.lastOrderAt = latest.toISOString();
    }
  }
  for (const row of recentOrders) get(row.customerId).ordersRecent = row._count._all;
  for (const row of rejections) get(row.customerId).rejectionsTotal = row._count._all;
  for (const row of views) {
    if (row.customerId) get(row.customerId).viewsRecent = row._count._all;
  }

  for (const grant of grants) {
    // Automatic renewals (an order extended access) are not an admin decision.
    if (grant.grantedBy.startsWith("system:")) continue;
    const h = get(grant.customerId);
    h.approvalsTotal += 1;
    const at = grant.approvedAt.toISOString();
    if (!h.lastApprovedAt || at > h.lastApprovedAt) h.lastApprovedAt = at;
  }
  // Second pass: needs lastOrderAt settled first.
  for (const grant of grants) {
    if (grant.grantedBy.startsWith("system:")) continue;
    const h = get(grant.customerId);
    if (!h.lastOrderAt || grant.approvedAt.toISOString() > h.lastOrderAt) {
      h.approvalsSinceLastOrder += 1;
    }
  }

  // Trail: admin approvals + real orders, per customer.
  const approvalsBy = new Map<string, string[]>();
  for (const grant of grants) {
    if (grant.grantedBy.startsWith("system:")) continue;
    const list = approvalsBy.get(grant.customerId) ?? [];
    list.push(grant.approvedAt.toISOString());
    approvalsBy.set(grant.customerId, list);
  }
  const ordersBy = new Map<string, string[]>();
  for (const o of orderDates) {
    const list = ordersBy.get(o.customerId) ?? [];
    list.push(o.placedAt.toISOString());
    ordersBy.set(o.customerId, list);
  }
  for (const id of ids) {
    const approvals = approvalsBy.get(id) ?? [];
    const orders = ordersBy.get(id) ?? [];
    if (approvals.length === 0 && orders.length === 0) continue;
    Object.assign(get(id), buildTrail(approvals, orders));
  }

  for (const id of ids) out.set(id, reviewAccess(hist.get(id) ?? { ...EMPTY_HISTORY }, now));
  return out;
}

/** Single-customer convenience. */
export async function getAccessReview(customerId: string, now?: Date): Promise<AccessReview> {
  return (await getAccessReviews([customerId], now)).get(customerId)!;
}

/**
 * Would setting this customer's expiry to `expiresAt` GIVE more access than
 * they have right now? Shortening (or ending) access must never be held — only
 * widening is an approval decision.
 */
export async function widensAccess(
  customerId: string,
  expiresAt: Date | null,
  now: Date = new Date(),
): Promise<boolean> {
  const live = await prisma.accessGrant.findFirst({
    where: {
      customerId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { approvedAt: "desc" },
    select: { expiresAt: true },
  });
  if (!live) return expiresAt === null || expiresAt.getTime() > now.getTime();
  if (live.expiresAt === null) return false; // already unlimited
  return expiresAt === null || expiresAt.getTime() > live.expiresAt.getTime();
}
