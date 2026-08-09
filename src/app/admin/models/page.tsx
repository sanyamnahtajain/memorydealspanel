import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { can } from "@/server/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { listDeviceModels } from "@/server/services/device-models";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import { DeviceModelManager } from "@/components/admin/models/DeviceModelManager";

export const metadata: Metadata = {
  title: "Device models — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Admin device-model master (the /admin/brands pattern): the list every
 * per-model order breakdown draws from. Server component — loads the full
 * list; the client manager handles search/create/bulk/status locally with
 * optimistic updates.
 */
export default async function AdminDeviceModelsPage() {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) {
    redirect("/admin/login");
  }
  if (!(await can(viewer, PERMISSIONS.DEVICE_MODELS_MANAGE))) {
    redirect("/admin");
  }

  const models = await listDeviceModels();

  return (
    <AdminShell title="Models">
      <div className="space-y-6">
        <PageHeader
          title="Device models"
          description="The master list buyers split quantities across (tempered glass, covers…). Deactivate models you no longer stock — deleting is blocked once carts or products reference them."
        />
        <DeviceModelManager initialModels={models} />
      </div>
    </AdminShell>
  );
}
