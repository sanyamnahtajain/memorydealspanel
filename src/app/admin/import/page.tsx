import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import { ImportWizard } from "@/components/admin/import/ImportWizard";

export const metadata: Metadata = {
  title: "Import — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

// Admin management surface — always live, never cached.
export const dynamic = "force-dynamic";

/**
 * Bulk product import (PRD F-A19) — server shell.
 *
 * Re-checks admin access (middleware bounces sessionless traffic, but a
 * customer session can still reach here), then renders the client
 * `ImportWizard`. All parsing, validation and commit run through admin-gated
 * server actions; nothing about the catalog is fetched here.
 */
export default async function AdminImportPage() {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) {
    redirect("/admin/login");
  }

  return (
    <AdminShell title="Import">
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader
          title="Import products"
          description="Upload a CSV or Excel file to create and update products in bulk. Preview and fix every row before anything is saved."
        />
        <ImportWizard />
      </div>
    </AdminShell>
  );
}
