import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { can } from "@/server/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { listBrands } from "@/server/services/brands";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import {
  RecentActivityPanel,
  RecentActivityPanelSkeleton,
} from "@/components/admin/audit/RecentActivityPanel";
import { BrandManager } from "@/components/admin/brands/BrandManager";

export const metadata: Metadata = {
  title: "Brands — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

// Admin management surface — always live, never cached.
export const dynamic = "force-dynamic";

/**
 * Admin brands management (server component).
 *
 * Re-checks admin + the BRANDS_MANAGE permission (middleware bounces
 * sessionless traffic, but a customer session can still reach here), then loads
 * every brand regardless of status — including INACTIVE ones, which the
 * storefront never enumerates — with live product counts. Rows are handed to
 * the client `BrandManager` for CRUD and status toggling.
 */
export default async function AdminBrandsPage() {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) {
    redirect("/admin/login");
  }
  if (!(await can(viewer, PERMISSIONS.BRANDS_MANAGE))) {
    redirect("/admin");
  }

  const brands = await listBrands();

  return (
    <AdminShell title="Brands">
      <div className="space-y-6">
        <PageHeader
          title="Brands"
          description="Your brand master. Products reference a brand from this list, so names stay consistent — no typos. Rename inline and hide brands from the storefront without deleting them."
        />
        <BrandManager initialBrands={brands} />

        {/* Module-level recent activity — subtle, admin-only, streams in. */}
        <div className="max-w-md">
          <Suspense fallback={<RecentActivityPanelSkeleton />}>
            <RecentActivityPanel entity="Brand" />
          </Suspense>
        </div>
      </div>
    </AdminShell>
  );
}
