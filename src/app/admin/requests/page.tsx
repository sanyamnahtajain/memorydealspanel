import type { Metadata } from "next";
import { redirect } from "next/navigation";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { getViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { PAGE_SIZES } from "@/lib/constants";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import {
  RequestsTabs,
  type DecidedRequest,
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

  const decidedWhere: Prisma.AccessRequestWhereInput = {
    status: { in: ["APPROVED", "REJECTED"] },
  };

  const [pendingRows, decidedRows, decidedTotal] = await Promise.all([
    prisma.accessRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        customerId: true,
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

  const pending: PendingRequest[] = pendingRows.map((row) => ({
    id: row.id,
    customerId: row.customerId,
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

  const pendingCount = pending.length;

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
          decided={decided}
          decidedPage={decidedPage}
          decidedPageCount={decidedPageCount}
          decidedTotal={decidedTotal}
          decidedPageSize={DECIDED_PAGE_SIZE}
          decidedPageParam={DECIDED_PAGE_PARAM}
        />
      </div>
    </AdminShell>
  );
}
