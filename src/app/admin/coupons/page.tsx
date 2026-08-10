import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { prisma } from "@/server/db";
import { getViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { can } from "@/server/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { listCoupons } from "@/server/services/coupons";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import { CouponsManager } from "@/components/admin/coupons/CouponsManager";

export const metadata: Metadata = {
  title: "Coupons — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Admin coupon manager. Loads the coupon list plus the names of every product
 * referenced by a scope (one batched read) so the editor can render the
 * scoping chips without an extra round-trip.
 */
export default async function AdminCouponsPage() {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) {
    redirect("/admin/login");
  }
  if (!(await can(viewer, PERMISSIONS.SETTINGS_MANAGE))) {
    redirect("/admin");
  }

  const coupons = await listCoupons();

  const scopedIds = [...new Set(coupons.flatMap((c) => c.productIds))];
  const scopedRows = scopedIds.length
    ? await prisma.product.findMany({
        where: { id: { in: scopedIds } },
        select: { id: true, name: true, sku: true },
      })
    : [];
  const scopedProducts = Object.fromEntries(
    scopedRows.map((p) => [p.id, { name: p.name, sku: p.sku }]),
  );

  return (
    <AdminShell title="Coupons">
      <div className="space-y-6">
        <PageHeader
          title="Coupons"
          description="Discount codes customers apply on their cart. A coupon can cover the whole cart or only specific products; redemptions are capped and locked in at placement."
        />
        <CouponsManager
          initialCoupons={coupons}
          initialScopedProducts={scopedProducts}
        />
      </div>
    </AdminShell>
  );
}
