import type { Metadata } from "next";

import { requirePermissionPage } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/lib/permissions";
import { getStoreSettings } from "@/server/services/store-settings";
import { parseSlabyBranding } from "@/lib/slaby/branding";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import { SlabyBrandingForm } from "@/components/admin/settings/SlabyBrandingForm";

export const metadata: Metadata = {
  title: "Slaby branding — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Admin › Settings › Slaby branding — where the "Built with Slaby" badges,
 * the order-success credit, and the occasional promo card are switched on/off
 * per placement (owner request: everything toggleable from the panel).
 */
export default async function AdminSlabyBrandingPage() {
  await requirePermissionPage(PERMISSIONS.SETTINGS_MANAGE);
  const settings = await getStoreSettings();
  const initial = parseSlabyBranding(settings.slabyBranding);

  return (
    <AdminShell title="Slaby branding">
      <div className="space-y-6">
        <PageHeader
          title="Slaby branding"
          description="Show “Built with Slaby” on the storefront — every placement is toggleable, and the master switch turns it all off."
          backHref="/admin/settings"
          backLabel="Settings"
        />
        <div className="max-w-2xl">
          <SlabyBrandingForm initial={initial} />
        </div>
      </div>
    </AdminShell>
  );
}
