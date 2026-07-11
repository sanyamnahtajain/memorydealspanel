import type { Metadata } from "next";

import { PERMISSIONS } from "@/lib/permissions";
import { requirePermissionPage } from "@/server/auth/permissions";
import { getSellerTaxProfile } from "@/server/services/tax-profile";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import { TaxSettingsForm } from "@/components/admin/settings/TaxSettingsForm";

export const metadata: Metadata = {
  title: "Tax settings — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

// Admin surface — always live so profile edits reflect immediately.
export const dynamic = "force-dynamic";

export default async function AdminTaxSettingsPage() {
  await requirePermissionPage(PERMISSIONS.SETTINGS_TAX_MANAGE);
  const profile = await getSellerTaxProfile();

  return (
    <AdminShell title="Tax settings">
      <div className="space-y-6">
        <PageHeader
          title="GST / tax"
          description="Configure how GST is applied, stored, and shown. While GST is turned off the catalogue and orders behave exactly as before — no tax figures anywhere."
        />

        <TaxSettingsForm
          initial={{
            gstEnabled: profile.gstEnabled,
            gstin: profile.gstin ?? "",
            legalName: profile.legalName ?? "",
            stateCode: profile.stateCode ?? "",
            priceEntryMode: profile.priceEntryMode,
            displayMode: profile.displayMode,
            roundingMode: profile.roundingMode,
            defaultGstRatePercent: profile.defaultGstRateBps / 100,
            defaultHsnCode: profile.defaultHsnCode ?? "",
          }}
        />
      </div>
    </AdminShell>
  );
}
