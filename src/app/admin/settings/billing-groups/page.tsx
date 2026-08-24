import type { Metadata } from "next";

import { PERMISSIONS } from "@/lib/permissions";
import { requirePermissionPage } from "@/server/auth/permissions";
import { listBillingGroups } from "@/server/services/billing-groups";
import { listActiveBrands } from "@/server/services/brands";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import { BillingGroupsManager } from "@/components/admin/billing-groups/BillingGroupsManager";

export const metadata: Metadata = {
  title: "Billing groups — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

// Admin surface — always live so rule edits reflect immediately.
export const dynamic = "force-dynamic";

export default async function AdminBillingGroupsPage() {
  await requirePermissionPage(PERMISSIONS.SETTINGS_MANAGE);
  const [groups, brands] = await Promise.all([listBillingGroups(), listActiveBrands()]);

  return (
    <AdminShell title="Billing groups">
      <div className="space-y-6">
        <PageHeader
          title="Billing groups"
          description="Split carts into brand buckets, each with its own tiered discount and bill page."
        />
        <BillingGroupsManager
          groups={groups.map((g) => ({
            id: g.id,
            name: g.name,
            code: g.code,
            color: g.color,
            active: g.active,
            sortOrder: g.sortOrder,
            matcher: g.matcher,
            rules: g.rules,
            separateBill: g.separateBill,
            couponStacking: g.couponStacking,
            notes: g.notes,
          }))}
          brands={brands}
        />
      </div>
    </AdminShell>
  );
}
