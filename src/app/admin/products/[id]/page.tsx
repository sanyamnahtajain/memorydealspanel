import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { prisma } from "@/server/db";
import { getViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { listAll } from "@/server/dal/categories";
import { listActiveBrands } from "@/server/services/brands";
import { toPricedProduct } from "@/server/dto/product";
import { getSellerTaxProfile } from "@/server/services/tax-profile";
import { resolveEffectiveTax } from "@/lib/tax-inherit";
import { objectIdSchema } from "@/lib/schemas/shared";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import {
  ProductEditorForm,
  type EditorProduct,
} from "@/components/admin/products/ProductEditorForm";
import {
  parseOptionTypes,
  toEditorVariants,
  type PersistedVariant,
} from "@/components/admin/products/variants";
import {
  AuditLogPreview,
  AuditLogPreviewSkeleton,
} from "@/components/admin/audit/AuditLogPreview";

export const metadata: Metadata = {
  title: "Edit product — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const EDIT_SELECT = {
  id: true,
  categoryId: true,
  name: true,
  slug: true,
  sku: true,
  brand: true,
  brandRef: { select: { id: true, name: true, slug: true } },
  description: true,
  specs: true,
  moq: true,
  stockStatus: true,
  status: true,
  tags: true,
  images: true,
  price: true,
  mrp: true,
  // GST override columns + the owning category's defaults, for the editor's
  // effective-tax preview / inherit hints. Non-monetary metadata.
  hsnCode: true,
  gstRateBps: true,
  taxTreatment: true,
  category: { select: { defaultHsnCode: true, defaultGstRateBps: true } },
  createdAt: true,
  updatedAt: true,
  // Variants (opt-in). `optionTypes`/`variants` are absent/empty for the
  // vast majority of products, so this is a no-op for non-variant catalog.
  hasVariants: true,
  optionTypes: true,
  variants: {
    select: {
      id: true,
      sku: true,
      optionValues: true,
      price: true,
      mrp: true,
      moq: true,
      stockStatus: true,
      status: true,
      isDefault: true,
      sortOrder: true,
      images: true,
    },
  },
} as const;

/**
 * Edit-product page (server component). Admin-only; loads the product (any
 * status, including soft-deleted for recovery editing) plus the category list,
 * then renders the shared ProductEditorForm seeded with the current values.
 */
export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) {
    redirect("/admin/login");
  }

  const { id } = await params;
  if (!objectIdSchema.safeParse(id).success) {
    notFound();
  }

  const [row, categories, brands] = await Promise.all([
    prisma.product.findUnique({ where: { id }, select: EDIT_SELECT }),
    listAll(viewer),
    listActiveBrands(),
  ]);

  if (!row) {
    notFound();
  }

  const profile = await getSellerTaxProfile();

  const priced = toPricedProduct(row);
  const product: EditorProduct = {
    id: priced.id,
    categoryId: priced.categoryId,
    name: priced.name,
    sku: priced.sku,
    brand: priced.brand,
    brandRef: priced.brandRef,
    description: priced.description,
    price: priced.price,
    mrp: priced.mrp,
    moq: priced.moq,
    stockStatus: priced.stockStatus,
    status: priced.status,
    tags: priced.tags,
    images: priced.images,
    specs: priced.specs,
    // Variant editor state. `toEditorVariants` sorts + guarantees one default;
    // `parseOptionTypes` defensively parses the embedded Json axis defs. Both
    // are empty for a non-variant product, so the editor renders unchanged.
    hasVariants: row.hasVariants,
    optionTypes: parseOptionTypes(row.optionTypes),
    variants: toEditorVariants(row.variants as PersistedVariant[]),
    // Raw GST overrides (null = inherit); fed back into the editor's fields.
    hsnCode: row.hsnCode,
    gstRateBps: row.gstRateBps,
    taxTreatment: row.taxTreatment,
  };

  // The tax section is shown only when the GST kill-switch is on. `inherited`
  // is the effective tax with the product's OWN overrides stripped out, so the
  // editor can show what applies when a field is left blank.
  const tax = profile.gstEnabled
    ? {
        inherited: resolveEffectiveTax({
          entity: {},
          category: row.category,
          profile: {
            defaultHsnCode: profile.defaultHsnCode,
            defaultGstRateBps: profile.defaultGstRateBps,
            priceEntryMode: profile.priceEntryMode,
          },
        }),
      }
    : undefined;

  return (
    <AdminShell title="Edit product">
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title={priced.name}
          description={`SKU ${priced.sku}`}
          backHref="/admin/products"
          backLabel="Products"
        />
        <ProductEditorForm
          product={product}
          tax={tax}
          brands={brands}
          categories={categories.map((c) => ({
            id: c.id,
            name: c.name,
            parentId: c.parentId,
          }))}
        />

        {/* Change history for this product. Self-loads (admin-only) and streams
            in behind a skeleton so it never blocks the editor. */}
        <Suspense fallback={<AuditLogPreviewSkeleton />}>
          <AuditLogPreview entity="Product" entityId={priced.id} />
        </Suspense>
      </div>
    </AdminShell>
  );
}
