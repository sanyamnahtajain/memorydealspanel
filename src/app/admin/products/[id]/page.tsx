import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { prisma } from "@/server/db";
import { getViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { listAll } from "@/server/dal/categories";
import { toPricedProduct } from "@/server/dto/product";
import { objectIdSchema } from "@/lib/schemas/shared";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import {
  ProductEditorForm,
  type EditorProduct,
} from "@/components/admin/products/ProductEditorForm";
import { ProductImagesField } from "@/components/admin/products/ProductImagesField";

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
  description: true,
  specs: true,
  moq: true,
  stockStatus: true,
  status: true,
  tags: true,
  images: true,
  price: true,
  mrp: true,
  createdAt: true,
  updatedAt: true,
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

  const [row, categories] = await Promise.all([
    prisma.product.findUnique({ where: { id }, select: EDIT_SELECT }),
    listAll(viewer),
  ]);

  if (!row) {
    notFound();
  }

  const priced = toPricedProduct(row);
  const product: EditorProduct = {
    id: priced.id,
    categoryId: priced.categoryId,
    name: priced.name,
    sku: priced.sku,
    brand: priced.brand,
    description: priced.description,
    price: priced.price,
    mrp: priced.mrp,
    moq: priced.moq,
    stockStatus: priced.stockStatus,
    status: priced.status,
    tags: priced.tags,
    images: priced.images,
    specs: priced.specs,
  };

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
          categories={categories.map((c) => ({
            id: c.id,
            name: c.name,
            parentId: c.parentId,
          }))}
          imagesSlot={({ images, onImagesChange, disabled }) => (
            <ProductImagesField
              productId={product.id}
              images={images}
              onImagesChange={onImagesChange}
              disabled={disabled}
            />
          )}
        />
      </div>
    </AdminShell>
  );
}
