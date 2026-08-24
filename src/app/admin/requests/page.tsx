import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { getViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { PAGE_SIZES } from "@/lib/constants";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import {
  RecentActivityPanel,
  RecentActivityPanelSkeleton,
} from "@/components/admin/audit/RecentActivityPanel";
import {
  RequestsTabs,
  type DecidedRequest,
  type RenewalItem,
} from "@/components/admin/requests/RequestsTabs";
import type { PendingRequest } from "@/components/admin/requests/ApprovalSwipeDeck";

export const metadata: Metadata = {
  title: "Access requests — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

// Admin review surface — always live so the queue reflects the latest state.
export const dynamic = "force-dynamic";

/** Decided requests shown per page in the history tab. */
const DECIDED_PAGE_SIZE = PAGE_SIZES.admin;

/** URL param carrying the decided-tab page (kept separate from any future
 * pending-tab paging so switching tabs never clobbers the other's page). */
const DECIDED_PAGE_PARAM = "dpage";

/**
 * Admin access-requests queue (server component).
 *
 * Re-checks admin (middleware bounces sessionless traffic, but a customer
 * session could still reach here), then loads pending requests for the review
 * deck and the most recent decided requests for the history tab. Each request
 * carries its customer's contact details so the client surface never needs a
 * second round-trip.
 */
export default async function AdminRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) {
    redirect("/admin/login");
  }

  const params = await searchParams;
  const rawDecidedPage = params[DECIDED_PAGE_PARAM];
  const decidedPageParam = Number(
    (Array.isArray(rawDecidedPage) ? rawDecidedPage[0] : rawDecidedPage) ?? "1",
  );
  const decidedPage =
    Number.isFinite(decidedPageParam) && decidedPageParam > 0
      ? Math.trunc(decidedPageParam)
      : 1;

  // Free-text search + a decided-status filter, both driven by the URL so they
  // survive refreshes and are shareable. The search runs SERVER-SIDE across the
  // requester's customer fields and is applied to EVERY tab — so a needle stays
  // findable in a 100-row haystack, including in the *paginated* Decided list
  // (a client-only filter would only ever see the current page).
  const rawQuery = params.q;
  const query = (Array.isArray(rawQuery) ? rawQuery[0] : (rawQuery ?? "")).trim();

  const rawDs = params.ds;
  const dsParam = (Array.isArray(rawDs) ? rawDs[0] : (rawDs ?? "")).toLowerCase();
  const decidedStatus: "all" | "approved" | "rejected" =
    dsParam === "approved" ? "approved" : dsParam === "rejected" ? "rejected" : "all";

  const customerWhere: Prisma.CustomerWhereInput | undefined = query
    ? {
        OR: [
          { businessName: { contains: query, mode: "insensitive" } },
          { contactName: { contains: query, mode: "insensitive" } },
          { phone: { contains: query, mode: "insensitive" } },
          { city: { contains: query, mode: "insensitive" } },
          { gstNumber: { contains: query, mode: "insensitive" } },
        ],
      }
    : undefined;

  const withSearch = (
    where: Prisma.AccessRequestWhereInput,
  ): Prisma.AccessRequestWhereInput =>
    customerWhere ? { ...where, customer: customerWhere } : where;

  const decidedStatuses: ("APPROVED" | "REJECTED")[] =
    decidedStatus === "approved"
      ? ["APPROVED"]
      : decidedStatus === "rejected"
        ? ["REJECTED"]
        : ["APPROVED", "REJECTED"];

  const decidedWhere: Prisma.AccessRequestWhereInput = withSearch({
    status: { in: decidedStatuses },
  });

  const [pendingRows, snoozedRows, decidedRows, decidedTotal] = await Promise.all([
    prisma.accessRequest.findMany({
      where: withSearch({ status: "PENDING" }),
      // Newest first (owner request) — with hundreds queued, the fresh ones
      // must be on top, not a scroll away.
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        customerId: true,
        renewal: true,
        createdAt: true,
        customer: {
          select: {
            businessName: true,
            contactName: true,
            phone: true,
            gstNumber: true,
            city: true,
          },
        },
      },
    }),
    prisma.accessRequest.findMany({
      where: withSearch({ status: "SNOOZED" }),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        customerId: true,
        renewal: true,
        createdAt: true,
        customer: {
          select: {
            businessName: true,
            contactName: true,
            phone: true,
            gstNumber: true,
            city: true,
          },
        },
      },
    }),
    prisma.accessRequest.findMany({
      where: decidedWhere,
      orderBy: [{ decidedAt: "desc" }, { createdAt: "desc" }],
      skip: (decidedPage - 1) * DECIDED_PAGE_SIZE,
      take: DECIDED_PAGE_SIZE,
      select: {
        id: true,
        status: true,
        reason: true,
        decidedAt: true,
        createdAt: true,
        customer: {
          select: {
            businessName: true,
            contactName: true,
            phone: true,
            gstNumber: true,
            city: true,
          },
        },
      },
    }),
    prisma.accessRequest.count({ where: decidedWhere }),
  ]);

  const decidedPageCount = Math.max(1, Math.ceil(decidedTotal / DECIDED_PAGE_SIZE));

  // ---- Renewals (owner request): who needs access renewed? -----------------
  // Two states in one queue: APPROVED customers whose EFFECTIVE live access
  // lapses within the window ("expiring"), and customers already EXPIRED.
  // Effective expiry = never, if ANY live grant is unlimited; else the LATEST
  // live expiry — so a customer with a fresh long grant never shows here.
  const RENEWAL_WINDOW_DAYS = 14;
  const now = new Date();
  const renewalWindowEnd = new Date(now.getTime() + RENEWAL_WINDOW_DAYS * 86_400_000);
  const renewalCustomerSelect = {
    businessName: true,
    contactName: true,
    phone: true,
    city: true,
  } as const;

  const [liveGrants, expiredGrants] = await Promise.all([
    prisma.accessGrant.findMany({
      where: {
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        customer: { status: "APPROVED", ...(customerWhere ?? {}) },
      },
      select: { customerId: true, expiresAt: true, customer: { select: renewalCustomerSelect } },
    }),
    // Latest lapsed grant per EXPIRED customer (distinct on the sorted rows).
    prisma.accessGrant.findMany({
      where: { customer: { status: "EXPIRED", ...(customerWhere ?? {}) } },
      orderBy: { expiresAt: "desc" },
      distinct: ["customerId"],
      take: 200,
      select: { customerId: true, expiresAt: true, customer: { select: renewalCustomerSelect } },
    }),
  ]);

  type EffectiveRow = { expiresAt: Date | null; customer: (typeof liveGrants)[number]["customer"] };
  const effectiveByCustomer = new Map<string, EffectiveRow>();
  for (const g of liveGrants) {
    const prev = effectiveByCustomer.get(g.customerId);
    if (!prev) {
      effectiveByCustomer.set(g.customerId, { expiresAt: g.expiresAt, customer: g.customer });
    } else if (prev.expiresAt !== null) {
      // Unlimited (null) wins; otherwise keep the LATEST expiry.
      prev.expiresAt =
        g.expiresAt === null || g.expiresAt > prev.expiresAt ? g.expiresAt : prev.expiresAt;
    }
  }

  const renewals: RenewalItem[] = [
    ...[...effectiveByCustomer.entries()]
      .filter(
        (e): e is [string, EffectiveRow & { expiresAt: Date }] =>
          e[1].expiresAt !== null && e[1].expiresAt <= renewalWindowEnd,
      )
      .sort((a, b) => a[1].expiresAt.getTime() - b[1].expiresAt.getTime())
      .map(([customerId, row]) => ({
        customerId,
        businessName: row.customer.businessName,
        contactName: row.customer.contactName,
        phone: row.customer.phone,
        city: row.customer.city ?? null,
        expiresAt: row.expiresAt.toISOString(),
        state: "expiring" as const,
      })),
    ...expiredGrants.map((g) => ({
      customerId: g.customerId,
      businessName: g.customer.businessName,
      contactName: g.customer.contactName,
      phone: g.customer.phone,
      city: g.customer.city ?? null,
      expiresAt: g.expiresAt ? g.expiresAt.toISOString() : null,
      state: "expired" as const,
    })),
  ];

  const pending: PendingRequest[] = pendingRows.map((row) => ({
    id: row.id,
    customerId: row.customerId,
    renewal: row.renewal,
    businessName: row.customer.businessName,
    contactName: row.customer.contactName,
    phone: row.customer.phone,
    gstNumber: row.customer.gstNumber ?? null,
    city: row.customer.city ?? null,
    createdAt: row.createdAt.toISOString(),
  }));

  const snoozed: PendingRequest[] = snoozedRows.map((row) => ({
    id: row.id,
    customerId: row.customerId,
    renewal: row.renewal,
    businessName: row.customer.businessName,
    contactName: row.customer.contactName,
    phone: row.customer.phone,
    gstNumber: row.customer.gstNumber ?? null,
    city: row.customer.city ?? null,
    createdAt: row.createdAt.toISOString(),
  }));

  const decided: DecidedRequest[] = decidedRows.map((row) => ({
    id: row.id,
    businessName: row.customer.businessName,
    contactName: row.customer.contactName,
    phone: row.customer.phone,
    gstNumber: row.customer.gstNumber ?? null,
    city: row.customer.city ?? null,
    // `status` is narrowed by the `in` filter above.
    status: row.status as "APPROVED" | "REJECTED",
    reason: row.reason ?? null,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }));

  // The sidebar badge + header describe the REAL backlog, so during an active
  // search (which narrows `pending`) fetch the true pending count separately.
  const pendingCount = query
    ? await prisma.accessRequest.count({ where: { status: "PENDING" } })
    : pending.length;

  return (
    <AdminShell
      title="Requests"
      badges={pendingCount > 0 ? { "/admin/requests": pendingCount } : undefined}
    >
      <div className="space-y-6">
        <PageHeader
          title="Access requests"
          description={
            pendingCount > 0
              ? `${pendingCount} ${pendingCount === 1 ? "request is" : "requests are"} waiting for review.`
              : "No requests are waiting for review."
          }
        />
        <RequestsTabs
          pending={pending}
          snoozed={snoozed}
          decided={decided}
          decidedPage={decidedPage}
          decidedPageCount={decidedPageCount}
          decidedTotal={decidedTotal}
          decidedPageSize={DECIDED_PAGE_SIZE}
          decidedPageParam={DECIDED_PAGE_PARAM}
          query={query}
          decidedStatus={decidedStatus}
          renewals={renewals}
        />

        {/* Recent access decisions & grants — audited under the Customer
            entity. Subtle, admin-only, streams in behind a skeleton. */}
        <div className="max-w-md">
          <Suspense fallback={<RecentActivityPanelSkeleton />}>
            <RecentActivityPanel
              entity="Customer"
              title="Recent access activity"
            />
          </Suspense>
        </div>
      </div>
    </AdminShell>
  );
}
