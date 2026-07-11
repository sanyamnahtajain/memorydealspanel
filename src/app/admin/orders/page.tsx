import type { Metadata } from "next";

import { requireAdminPage } from "@/server/auth/require-admin-page";
import { assertPermission } from "@/server/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { PAGE_SIZES } from "@/lib/constants";
import {
  countOrders,
  listOrders,
  orderStatusCounts,
} from "@/server/services/admin-orders";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import { OrderQueueTable } from "@/components/admin/orders/OrderQueueTable";
import { OrderAbuseView } from "@/components/admin/orders/OrderAbuseView";
import type { OrderRowDTO } from "@/server/actions/admin-orders";
import type { OrderStatus } from "@prisma/client";

export const metadata: Metadata = {
  title: "Orders — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

// Admin surface — always live so new orders + status changes reflect at once.
export const dynamic = "force-dynamic";

const ORDER_STATUSES: OrderStatus[] = [
  "PLACED",
  "CONFIRMED",
  "PROCESSING",
  "FULFILLED",
  "CANCELLED",
];

function parseStatus(value: string | undefined): OrderStatus | undefined {
  return value && (ORDER_STATUSES as string[]).includes(value)
    ? (value as OrderStatus)
    : undefined;
}

const PAGE_SIZE = PAGE_SIZES.admin;

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const viewer = await requireAdminPage();
  // Reads are gated on the customers-view capability (orders are a customer
  // artefact; there's no dedicated orders permission in the catalog yet).
  await assertPermission(viewer, PERMISSIONS.CUSTOMERS_VIEW);

  const params = await searchParams;
  const status = parseStatus(params.status);
  const search = params.q?.trim() || undefined;
  const parsedPage = Number(params.page ?? "1");
  const page =
    Number.isFinite(parsedPage) && parsedPage > 0 ? Math.trunc(parsedPage) : 1;

  const [items, filteredTotal, counts] = await Promise.all([
    listOrders({
      status,
      customer: search,
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    countOrders({ status, customer: search }),
    orderStatusCounts(),
  ]);

  const rows: OrderRowDTO[] = items.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    itemCount: o.itemCount,
    subtotalPaise: o.subtotalPaise,
    placedAt: o.placedAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    customer: o.customer
      ? {
          id: o.customer.id,
          businessName: o.customer.businessName,
          contactName: o.customer.contactName,
          phone: o.customer.phone,
          city: o.customer.city,
        }
      : null,
  }));

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const pageCount = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));

  const newCount = counts.PLACED;
  const description =
    newCount > 0
      ? `${newCount} new ${newCount === 1 ? "order" : "orders"} awaiting confirmation — ${total} total.`
      : `${total} ${total === 1 ? "order" : "orders"} — purchase requests to fulfil offline.`;

  return (
    <AdminShell title="Orders" badges={{ "/admin/orders": newCount }}>
      <div className="space-y-6">
        <PageHeader title="Orders" description={description} />

        <OrderQueueTable
          rows={rows}
          counts={counts}
          activeStatus={status ?? null}
          search={search ?? ""}
          page={page}
          pageCount={pageCount}
          total={filteredTotal}
          pageSize={PAGE_SIZE}
        />

        <div className="max-w-md">
          <OrderAbuseView />
        </div>
      </div>
    </AdminShell>
  );
}
