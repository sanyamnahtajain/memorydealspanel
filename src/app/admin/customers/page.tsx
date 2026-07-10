import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

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
  listCustomers,
  countCustomers,
  customerStatusCounts,
  type CustomerListItem,
} from "@/server/services/customers";
import { customerStatusSchema, type CustomerStatus } from "@/lib/schemas/shared";
import { CustomerTable } from "@/components/admin/customers/CustomerTable";

export const metadata: Metadata = {
  title: "Customers — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

// Admin surface — always live so status changes reflect immediately.
export const dynamic = "force-dynamic";

function parseStatus(value: string | undefined): CustomerStatus | undefined {
  const parsed = customerStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Serialisable row shape handed to the client table (Dates -> ISO strings). */
export interface CustomerRowData {
  id: string;
  businessName: string;
  contactName: string;
  phone: string;
  email: string | null;
  gstNumber: string | null;
  city: string | null;
  status: CustomerStatus;
  notes: string | null;
  priceAccess: boolean;
  expiresAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

function toRow(c: CustomerListItem): CustomerRowData {
  return {
    id: c.id,
    businessName: c.businessName,
    contactName: c.contactName,
    phone: c.phone,
    email: c.email,
    gstNumber: c.gstNumber,
    city: c.city,
    status: c.status,
    notes: c.notes,
    priceAccess: c.priceAccess,
    expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
    lastLoginAt: c.lastLoginAt ? c.lastLoginAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
  };
}

/** Customers per page in the admin table. */
const CUSTOMERS_PAGE_SIZE = PAGE_SIZES.admin;

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) {
    redirect("/admin/login");
  }

  const params = await searchParams;
  const status = parseStatus(params.status);
  const search = params.q?.trim() || undefined;
  const parsedPage = Number(params.page ?? "1");
  const page =
    Number.isFinite(parsedPage) && parsedPage > 0 ? Math.trunc(parsedPage) : 1;

  const [customers, filteredTotal, counts] = await Promise.all([
    listCustomers({
      status,
      search,
      take: CUSTOMERS_PAGE_SIZE,
      skip: (page - 1) * CUSTOMERS_PAGE_SIZE,
    }),
    countCustomers({ status, search }),
    customerStatusCounts(),
  ]);

  const rows = customers.map(toRow);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const pageCount = Math.max(1, Math.ceil(filteredTotal / CUSTOMERS_PAGE_SIZE));

  return (
    <AdminShell title="Customers">
      <div className="space-y-6">
        <PageHeader
          title="Customers"
          description={`${total} ${total === 1 ? "customer" : "customers"} — manage access, expiry, and details.`}
        />
        <CustomerTable
          rows={rows}
          counts={counts}
          activeStatus={status ?? null}
          search={search ?? ""}
          page={page}
          pageCount={pageCount}
          total={filteredTotal}
          pageSize={CUSTOMERS_PAGE_SIZE}
        />

        {/* Module-level recent activity — subtle, admin-only, streams in. */}
        <div className="max-w-md">
          <Suspense fallback={<RecentActivityPanelSkeleton />}>
            <RecentActivityPanel entity="Customer" />
          </Suspense>
        </div>
      </div>
    </AdminShell>
  );
}
