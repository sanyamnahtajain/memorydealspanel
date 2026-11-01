import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { prisma } from "@/server/db";
import { getViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { can } from "@/server/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { objectIdSchema } from "@/lib/schemas/shared";
import { parseBrandLayout } from "@/lib/brand-layout";
import { listBrandCategoriesUncached } from "@/server/dal/brands";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import { BrandPageEditor, type EditorCategory } from "@/components/admin/brands/BrandPageEditor";

export const metadata: Metadata = {
  title: "Brand page — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Admin › Brands › {brand} — how the brand's page looks on the storefront:
 * cover artwork, a one-line tagline, the brand's position on the home page,
 * and its category rail (order, a brand-specific photo, a display name, and
 * hide) for every category the brand has products in.
 *
 * Categories the owner configured earlier but that have no visible products
 * right now are still listed (marked "no products now"), so their photo and
 * position survive a temporary stock-out.
 */
export default async function AdminBrandPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) redirect("/admin/login");
  if (!(await can(viewer, PERMISSIONS.BRANDS_MANAGE))) redirect("/admin");

  const { id } = await params;
  const parsedId = objectIdSchema.safeParse(id);
  if (!parsedId.success) notFound();

  const brand = await prisma.brand.findUnique({
    where: { id: parsedId.data },
    select: {
      id: true,
      name: true,
      slug: true,
      logo: true,
      status: true,
      sortOrder: true,
      coverImage: true,
      tagline: true,
      categoryLayout: true,
    },
  });
  if (!brand) notFound();

  const layout = parseBrandLayout(brand.categoryLayout);
  const live = await listBrandCategoriesUncached(brand.id);
  const liveById = new Map(live.map((c) => [c.id, c]));

  // Configured categories that have no live products now: still editable.
  const missingIds = layout.map((e) => e.categoryId).filter((cid) => !liveById.has(cid));
  const missing = missingIds.length
    ? await prisma.category.findMany({
        where: { id: { in: missingIds } },
        select: { id: true, name: true, slug: true, image: true },
      })
    : [];
  const missingById = new Map(missing.map((c) => [c.id, c]));

  // Editor rows in the effective order: configured first (owner order), then
  // the unconfigured live ones in catalogue order.
  const rows: EditorCategory[] = [];
  const placed = new Set<string>();
  for (const entry of layout) {
    const cat = liveById.get(entry.categoryId) ?? missingById.get(entry.categoryId);
    if (!cat) continue; // category deleted since — nothing to configure
    placed.add(cat.id);
    rows.push({
      categoryId: cat.id,
      name: cat.name,
      defaultImage: cat.image ?? null,
      count: liveById.get(cat.id)?.count ?? 0,
      image: entry.image ?? null,
      label: entry.label ?? "",
      hidden: entry.hidden,
    });
  }
  for (const cat of live) {
    if (placed.has(cat.id)) continue;
    rows.push({
      categoryId: cat.id,
      name: cat.name,
      defaultImage: cat.image ?? null,
      count: cat.count,
      image: null,
      label: "",
      hidden: false,
    });
  }

  return (
    <AdminShell title="Brand page">
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title={`${brand.name} — brand page`}
          description="What shoppers see when they open this brand: the cover, one line about the brand, and the category rail — in your order, with your photos."
          backHref="/admin/brands"
          backLabel="Brands"
        />
        <BrandPageEditor
          brand={{
            id: brand.id,
            name: brand.name,
            slug: brand.slug,
            logo: brand.logo ?? null,
            active: brand.status === "ACTIVE",
            sortOrder: brand.sortOrder,
            coverImage: brand.coverImage ?? null,
            tagline: brand.tagline ?? "",
          }}
          initialRows={rows}
        />
      </div>
    </AdminShell>
  );
}
