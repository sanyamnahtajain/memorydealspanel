import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Boxes, ClipboardList, Users } from "lucide-react";

import { prisma } from "@/server/db";
import { getViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader, StatCard } from "@/components/common";

export const metadata: Metadata = {
  title: "Dashboard — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

// Counts are live and per-request; never cache the admin dashboard.
export const dynamic = "force-dynamic";

/**
 * Admin dashboard (server component).
 *
 * Authoritative gate: `getViewer` resolves a DB-backed viewer and `isAdmin`
 * decides. Middleware already bounced sessionless traffic, but a customer
 * session reaches here too — so this re-check is the real lock; non-admins are
 * redirected to the admin login. Only after that do we read live counts.
 *
 * This is a Phase-2 placeholder: it renders the shell, header and three real
 * KPI cards (products / customers / pending access requests). Deep-linked
 * management pages arrive in later phases.
 */
export default async function AdminDashboardPage() {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) {
    redirect("/admin/login");
  }

  const [productCount, customerCount, pendingRequestCount] = await Promise.all([
    prisma.product.count(),
    prisma.customer.count(),
    prisma.accessRequest.count({ where: { status: "PENDING" } }),
  ]);

  const numberFmt = new Intl.NumberFormat("en-IN");

  return (
    <AdminShell title="Dashboard" badges={{ "/admin/requests": pendingRequestCount }}>
      <div className="space-y-6">
        <PageHeader
          title="Dashboard"
          description="Catalog and customer activity at a glance."
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Products"
            value={numberFmt.format(productCount)}
            icon={<Boxes aria-hidden />}
          />
          <StatCard
            label="Customers"
            value={numberFmt.format(customerCount)}
            icon={<Users aria-hidden />}
          />
          <StatCard
            label="Pending requests"
            value={numberFmt.format(pendingRequestCount)}
            icon={<ClipboardList aria-hidden />}
          />
        </div>
      </div>
    </AdminShell>
  );
}
