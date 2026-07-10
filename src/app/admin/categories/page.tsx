import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { prisma } from "@/server/db";
import { getViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import {
  RecentActivityPanel,
  RecentActivityPanelSkeleton,
} from "@/components/admin/audit/RecentActivityPanel";
import {
  CategoryManager,
  type CategoryNode,
} from "@/components/admin/categories/CategoryManager";

export const metadata: Metadata = {
  title: "Categories — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

// Admin management surface — always live, never cached.
export const dynamic = "force-dynamic";

/**
 * Admin categories management (server component).
 *
 * Re-checks admin (middleware bounces sessionless traffic, but a customer
 * session can still reach here), then loads every category regardless of
 * status — including INACTIVE ones, which the storefront never enumerates —
 * with live product counts. Rows are grouped parent > children and handed to
 * the client `CategoryManager` for CRUD, reorder and status toggling.
 */
export default async function AdminCategoriesPage() {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) {
    redirect("/admin/login");
  }

  const rows = await prisma.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      image: true,
      sortOrder: true,
      status: true,
      parentId: true,
      // Non-deleted products directly in this category.
      _count: {
        select: { products: { where: { deletedAt: null } } },
      },
    },
  });

  const byParent = new Map<string, typeof rows>();
  const roots: typeof rows = [];
  for (const row of rows) {
    if (row.parentId) {
      const bucket = byParent.get(row.parentId) ?? [];
      bucket.push(row);
      byParent.set(row.parentId, bucket);
    } else {
      roots.push(row);
    }
  }

  const tree: CategoryNode[] = roots.map((root) => {
    const children = (byParent.get(root.id) ?? []).map((child) => ({
      id: child.id,
      name: child.name,
      slug: child.slug,
      image: child.image ?? null,
      sortOrder: child.sortOrder,
      status: child.status,
      parentId: child.parentId ?? null,
      productCount: child._count.products,
    }));
    // Direct products + products in sub-categories, for the parent summary.
    const childProductTotal = children.reduce(
      (sum, c) => sum + c.productCount,
      0,
    );
    return {
      id: root.id,
      name: root.name,
      slug: root.slug,
      image: root.image ?? null,
      sortOrder: root.sortOrder,
      status: root.status,
      parentId: null,
      productCount: root._count.products,
      childProductTotal,
      children,
    };
  });

  return (
    <AdminShell title="Categories">
      <div className="space-y-6">
        <PageHeader
          title="Categories"
          description="Organize your catalog. Drag to reorder, rename inline, and hide categories from the storefront without deleting them."
        />
        <CategoryManager initialCategories={tree} />

        {/* Module-level recent activity — subtle, admin-only, streams in. */}
        <div className="max-w-md">
          <Suspense fallback={<RecentActivityPanelSkeleton />}>
            <RecentActivityPanel entity="Category" />
          </Suspense>
        </div>
      </div>
    </AdminShell>
  );
}
