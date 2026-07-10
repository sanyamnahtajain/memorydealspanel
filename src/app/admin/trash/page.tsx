import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { prisma } from "@/server/db";
import { resolveViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { AdminShell } from "@/components/shell/AdminShell";
import { EmptyState, PageHeader } from "@/components/common";
import { TrashList, TRASH_RETENTION_DAYS } from "@/components/admin/trash";
import type { TrashedProduct } from "@/components/admin/trash";

export const metadata: Metadata = {
  title: "Trash — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

// Soft-delete state is live; never cache.
export const dynamic = "force-dynamic";

const RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Admin trash (server component).
 *
 * Lists soft-deleted products (`deletedAt != null`) with a restore action and
 * a retention countdown. Admin-gated via `resolveViewer` + `isAdmin`;
 * non-admins are redirected to the admin login. Products are oldest-deletion
 * first so the ones closest to permanent purge surface at the top.
 */
export default async function AdminTrashPage() {
  const viewer = await resolveViewer();
  if (!isAdmin(viewer)) {
    redirect("/admin/login");
  }

  const rows = await prisma.product.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: "asc" },
    select: {
      id: true,
      name: true,
      sku: true,
      brand: true,
      deletedAt: true,
      images: true,
      category: { select: { name: true } },
    },
  });

  const products: TrashedProduct[] = rows.map((row) => {
    // deletedAt is guaranteed non-null by the where clause, but narrow safely.
    const deletedAt = row.deletedAt ?? new Date();
    const primary = row.images.find((img) => img.isPrimary) ?? row.images[0];
    return {
      id: row.id,
      name: row.name,
      sku: row.sku,
      brand: row.brand ?? null,
      categoryName: row.category?.name ?? null,
      imageUrl: primary?.thumbUrl ?? primary?.url ?? null,
      deletedAt: deletedAt.toISOString(),
      purgeAt: new Date(deletedAt.getTime() + RETENTION_MS).toISOString(),
    };
  });

  // Captured once at request time; `new Date()` keeps this render-pure per lint.
  const now = new Date().getTime();

  return (
    <AdminShell title="Trash">
      <div className="space-y-6">
        <PageHeader
          title="Trash"
          description={`Deleted products are kept for ${TRASH_RETENTION_DAYS} days, then permanently removed. Restore any product before its countdown ends.`}
        />

        {products.length === 0 ? (
          <EmptyState
            illustration="empty-box"
            title="Trash is empty"
            description="Deleted products will appear here with a 30-day window to restore them."
          />
        ) : (
          <TrashList products={products} now={now} />
        )}
      </div>
    </AdminShell>
  );
}
