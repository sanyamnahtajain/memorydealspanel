import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { can } from "@/server/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { listBannersForAdmin } from "@/server/services/banners";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import {
  RecentActivityPanel,
  RecentActivityPanelSkeleton,
} from "@/components/admin/audit/RecentActivityPanel";
import { BannerManager } from "@/components/admin/banners/BannerManager";

export const metadata: Metadata = {
  title: "Banners — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

// Admin management surface — always live, never cached.
export const dynamic = "force-dynamic";

/**
 * Storefront promo banners (server component).
 *
 * Re-checks admin + SETTINGS_MANAGE — middleware bounces sessionless traffic,
 * but a customer session can still reach here. Loads EVERY banner, live or
 * not, because the whole point of the admin list is to show the ones the
 * storefront is hiding and say why.
 */
export default async function AdminBannersPage() {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) {
    redirect("/admin/login");
  }
  if (!(await can(viewer, PERMISSIONS.SETTINGS_MANAGE))) {
    redirect("/admin");
  }

  const banners = await listBannersForAdmin();

  return (
    <AdminShell title="Banners">
      <div className="space-y-6">
        <PageHeader
          title="Banners"
          description="The promo strip shoppers see first. Upload artwork, point it at a page, and optionally schedule it — a banner can start and finish on its own. Turn one off without deleting it."
        />
        <BannerManager banners={banners} />

        <div className="max-w-md">
          <Suspense fallback={<RecentActivityPanelSkeleton />}>
            <RecentActivityPanel entity="Banner" />
          </Suspense>
        </div>
      </div>
    </AdminShell>
  );
}
