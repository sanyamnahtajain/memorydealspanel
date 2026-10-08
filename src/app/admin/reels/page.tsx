import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { can } from "@/server/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { listReelsForAdmin } from "@/server/services/reels";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import {
  RecentActivityPanel,
  RecentActivityPanelSkeleton,
} from "@/components/admin/audit/RecentActivityPanel";
import { ReelManager } from "@/components/admin/reels/ReelManager";

export const metadata: Metadata = {
  title: "Reels — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

// Admin management surface — always live, never cached.
export const dynamic = "force-dynamic";

/**
 * Storefront reels (server component).
 *
 * Re-checks admin + SETTINGS_MANAGE — middleware bounces sessionless traffic,
 * but a customer session can still reach here. Loads EVERY reel, live or not,
 * so the admin can see what the storefront is hiding.
 */
export default async function AdminReelsPage() {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) {
    redirect("/admin/login");
  }
  if (!(await can(viewer, PERMISSIONS.SETTINGS_MANAGE))) {
    redirect("/admin");
  }

  const reels = await listReelsForAdmin();

  return (
    <AdminShell title="Reels">
      <div className="space-y-6">
        <PageHeader
          title="Reels"
          description="Short vertical clips — the ones you post on Instagram — hosted on the shop. They play in the rail on the home page and in the full-screen feed at /reels. Link each one to the product it shows."
        />
        <ReelManager reels={reels} />

        <div className="max-w-md">
          <Suspense fallback={<RecentActivityPanelSkeleton />}>
            <RecentActivityPanel entity="Reel" />
          </Suspense>
        </div>
      </div>
    </AdminShell>
  );
}
