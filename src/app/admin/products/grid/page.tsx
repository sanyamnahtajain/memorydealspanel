import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { getViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { listForAdminGrid } from "@/server/dal/products";
import { listAll } from "@/server/dal/categories";
import { listActiveBrands } from "@/server/services/brands";
import { getSellerTaxProfile } from "@/server/services/tax-profile";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { ProductGrid } from "@/components/admin/products-grid/ProductGrid";
import { toProductRow } from "@/components/admin/products-grid/adapters";

export const metadata: Metadata = {
  title: "Bulk edit — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Admin bulk-edit grid (server component).
 *
 * Re-checks admin access (a customer session can technically reach this path),
 * loads every non-deleted product WITH prices via the admin-only DAL and the
 * full category list for the colored category select, projects the products
 * into grid rows, and hands them to the client `ProductGrid`. All editing —
 * inline autosave, paste, fill, bulk ops — flows through the DealSheet engine
 * and the `saveProductField` action.
 */
export default async function AdminProductsGridPage() {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) {
    redirect("/admin/login");
  }

  const [products, categories, brands, taxProfile] = await Promise.all([
    listForAdminGrid(viewer, { all: true }),
    listAll(viewer),
    listActiveBrands(),
    getSellerTaxProfile(),
  ]);

  const rows = products.map(toProductRow);

  return (
    <AdminShell title="Bulk edit">
      <div className="space-y-6">
        <PageHeader
          title="Bulk edit"
          description={
            rows.length > 0
              ? `Spreadsheet editing across ${rows.length} product${
                  rows.length === 1 ? "" : "s"
                }. Changes autosave.`
              : "Spreadsheet editing for your catalog. Changes autosave."
          }
          actions={
            <Button variant="outline" render={<Link href="/admin/products" />}>
              <ArrowLeftIcon aria-hidden />
              Back to products
            </Button>
          }
        />

        <ProductGrid
          rows={rows}
          categories={categories}
          brands={brands}
          gstEnabled={taxProfile.gstEnabled}
        />
      </div>
    </AdminShell>
  );
}
