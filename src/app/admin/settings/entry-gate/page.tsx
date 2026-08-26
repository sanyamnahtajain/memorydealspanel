import type { Metadata } from "next";

import { requirePermissionPage } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/lib/permissions";
import { getEntryGate } from "@/server/auth/entry-gate";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import { EntryGateForm } from "@/components/admin/settings/EntryGateForm";

export const metadata: Metadata = {
  title: "Shop code — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Admin › Settings › Shop code — the entry gate for NEW customers (see
 * src/lib/entry-gate.ts). The owner turns it on/off, reads the current code
 * back out to share it, and rotates it after a leak — rotation alone locks
 * out every old copy.
 */
export default async function AdminEntryGatePage() {
  await requirePermissionPage(PERMISSIONS.SETTINGS_MANAGE);
  const gate = await getEntryGate();

  return (
    <AdminShell title="Shop code">
      <div className="space-y-6">
        <PageHeader
          title="Shop code"
          description="The code new customers must enter before they can ask for prices. Existing customers are never asked."
          backHref="/admin/settings"
          backLabel="Settings"
        />
        <div className="max-w-2xl rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xs">
          <EntryGateForm initial={gate} />
        </div>
      </div>
    </AdminShell>
  );
}
