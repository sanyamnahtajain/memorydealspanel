import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { prisma } from "@/server/db";
import { getViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
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

/** How many decided requests to show in the history tab. */
const DECIDED_LIMIT = 50;

/**
 * Admin access-requests queue (server component).
 *
 * Re-checks admin (middleware bounces sessionless traffic, but a customer
 * session could still reach here), then loads pending requests for the review
 * deck and the most recent decided requests for the history tab. Each request
 * carries its customer's contact details so the client surface never needs a
 * second round-trip.
 */
export default async function AdminRequestsPage() {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) {
    redirect("/admin/login");
  }

  const [pendingRows, decidedRows] = await Promise.all([
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
      where: { status: { in: ["APPROVED", "REJECTED"] } },
      orderBy: [{ decidedAt: "desc" }, { createdAt: "desc" }],
      take: DECIDED_LIMIT,
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
  ]);

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
        <RequestsTabs pending={pending} decided={decided} />
      </div>
    </AdminShell>
  );
}
