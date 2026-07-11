import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { listAll } from "@/server/dal/categories";
import { listActiveBrands } from "@/server/services/brands";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import { ProductEditorForm } from "@/components/admin/products/ProductEditorForm";

export const metadata: Metadata = {
  title: "New product — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Create-product page (server component). Loads the category list for the
 * editor's select, then renders the shared ProductEditorForm in create mode.
 */
export default async function NewProductPage() {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) {
    redirect("/admin/login");
  }

  const [categories, brands] = await Promise.all([
    listAll(viewer),
    listActiveBrands(),
  ]);

  return (
    <AdminShell title="New product">
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title="New product"
          description="Add a product to the catalog."
          backHref="/admin/products"
          backLabel="Products"
        />
        <ProductEditorForm
          brands={brands}
          categories={categories.map((c) => ({
            id: c.id,
            name: c.name,
            parentId: c.parentId,
          }))}
        />
      </div>
    </AdminShell>
  );
}
