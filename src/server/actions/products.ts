"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { resolveViewer } from "@/server/auth/viewer";
import { assertAdmin, isForbiddenError } from "@/server/dal/guard";
import { assertPermission } from "@/server/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { writeAudit } from "@/server/security/audit";
import {
  toPricedProduct,
  type PricedProduct,
} from "@/server/dto/product";
import {
  createProductSchema,
  updateProductSchema,
  type CreateProductInput,
  type UpdateProductInput,
} from "@/lib/schemas/product";
import {
  entityStatusSchema,
  objectIdSchema,
} from "@/lib/schemas/shared";
import {
  listProductsInputSchema,
  type ListProductsInput,
  type ListProductsResult,
  type ProductSort,
} from "@/server/actions/product-list-schema";
import {
  createProduct,
  duplicateProduct,
  isProductServiceError,
  restoreProduct,
  setProductStatus,
  softDeleteProduct,
  updateProduct,
} from "@/server/services/products";

/**
 * Admin product server actions.
 *
 * Every mutating action follows the same contract:
 *   1. resolveViewer() + assertAdmin(viewer)  — authorisation
 *   2. zod validation of the input             — never trust the client
 *   3. delegate to the service layer           — domain logic + invariants
 *   4. writeAudit(...)                         — tamper-evident trail
 *   5. revalidatePath(...)                     — refresh the RSC caches
 *
 * Nothing throws to the client: failures come back as a typed
 * `{ ok: false, error }`. Only unexpected/programmer errors bubble up.
 */

export type ActionResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const ACTOR = "admin" as const;

/** Wraps an action body so ForbiddenError and service errors become results. */
async function guarded<T>(
  run: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (error) {
    if (isForbiddenError(error)) {
      return { ok: false, error: "You are not authorised to do that." };
    }
    if (isProductServiceError(error)) {
      return { ok: false, error: error.message };
    }
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues[0]?.message ?? "Invalid input." };
    }
    console.error("[actions/products] unexpected error:", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

function revalidateProductViews(id?: string): void {
  revalidatePath("/admin/products");
  if (id) {
    revalidatePath(`/admin/products/${id}`);
  }
  // The only cached storefront surface that shows product cards is the home
  // page (ISR, `revalidate = 300`); product/category reads are `force-dynamic`
  // and rebuild per request. Revalidating just "/" (a page, not the whole
  // layout tree) keeps that fresh without busting the entire app cache on
  // every single field save — the grid fires one of these per edited cell.
  revalidatePath("/");
}

/* ------------------------------------------------------------------ */
/* create                                                              */
/* ------------------------------------------------------------------ */

export async function createProductAction(
  input: CreateProductInput,
): Promise<ActionResult<{ product: PricedProduct }>> {
  return guarded(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.PRODUCTS_EDIT);

    const data = createProductSchema.parse(input);
    const product = await createProduct(data);

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "product.create",
      entity: "Product",
      entityId: product.id,
      diff: {
        after: {
          name: product.name,
          sku: product.sku,
          brandId: product.brandRef?.id ?? null,
        },
      },
    });

    revalidateProductViews(product.id);
    return { ok: true, product };
  });
}

/* ------------------------------------------------------------------ */
/* update                                                              */
/* ------------------------------------------------------------------ */

export async function updateProductAction(
  id: string,
  patch: UpdateProductInput,
): Promise<ActionResult<{ product: PricedProduct }>> {
  return guarded(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.PRODUCTS_EDIT);

    const productId = objectIdSchema.parse(id);
    const data = updateProductSchema.parse(patch);
    const product = await updateProduct(productId, data);

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "product.update",
      entity: "Product",
      entityId: product.id,
      diff: { changed: Object.keys(data) },
    });

    revalidateProductViews(product.id);
    return { ok: true, product };
  });
}

/**
 * Single-field autosave entrypoint (future grid wiring). Accepts a one-key
 * patch, validates it through the same partial schema, audits and revalidates.
 * Returns the freshly persisted product so the caller can reconcile.
 */
export async function saveProductField(
  id: string,
  patch: UpdateProductInput,
): Promise<ActionResult<{ product: PricedProduct }>> {
  return guarded<{ product: PricedProduct }>(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.PRODUCTS_EDIT);

    const productId = objectIdSchema.parse(id);
    const data = updateProductSchema.parse(patch);
    if (Object.keys(data).length === 0) {
      return { ok: false, error: "No field to save." };
    }

    const product = await updateProduct(productId, data);

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "product.field.save",
      entity: "Product",
      entityId: product.id,
      diff: { field: Object.keys(data)[0] },
    });

    revalidateProductViews(product.id);
    return { ok: true, product };
  });
}

/* ------------------------------------------------------------------ */
/* duplicate                                                           */
/* ------------------------------------------------------------------ */

export async function duplicateProductAction(
  id: string,
): Promise<ActionResult<{ product: PricedProduct }>> {
  return guarded(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.PRODUCTS_EDIT);

    const productId = objectIdSchema.parse(id);
    const product = await duplicateProduct(productId);

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "product.duplicate",
      entity: "Product",
      entityId: product.id,
      diff: { from: productId },
    });

    revalidateProductViews(product.id);
    return { ok: true, product };
  });
}

/* ------------------------------------------------------------------ */
/* status toggle / soft-delete / restore                              */
/* ------------------------------------------------------------------ */

export async function setProductStatusAction(
  id: string,
  status: unknown,
): Promise<ActionResult<{ product: PricedProduct }>> {
  return guarded(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.PRODUCTS_EDIT);

    const productId = objectIdSchema.parse(id);
    const nextStatus = entityStatusSchema.parse(status);
    const product = await setProductStatus(productId, nextStatus);

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "product.status",
      entity: "Product",
      entityId: product.id,
      diff: { status: nextStatus },
    });

    revalidateProductViews(product.id);
    return { ok: true, product };
  });
}

export async function softDeleteProductAction(
  id: string,
): Promise<ActionResult<{ product: PricedProduct }>> {
  return guarded(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.PRODUCTS_DELETE);

    const productId = objectIdSchema.parse(id);
    const product = await softDeleteProduct(productId);

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "product.softDelete",
      entity: "Product",
      entityId: product.id,
    });

    revalidateProductViews(product.id);
    revalidatePath("/admin/trash");
    return { ok: true, product };
  });
}

export async function restoreProductAction(
  id: string,
): Promise<ActionResult<{ product: PricedProduct }>> {
  return guarded(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.PRODUCTS_DELETE);

    const productId = objectIdSchema.parse(id);
    const product = await restoreProduct(productId);

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "product.restore",
      entity: "Product",
      entityId: product.id,
    });

    revalidateProductViews(product.id);
    revalidatePath("/admin/trash");
    return { ok: true, product };
  });
}

/* ------------------------------------------------------------------ */
/* listProductsAction — filtered admin list for the CRUD page          */
/* ------------------------------------------------------------------ */

const SORT_ORDER: Record<ProductSort, Prisma.ProductOrderByWithRelationInput[]> =
  {
    newest: [{ createdAt: "desc" }, { id: "asc" }],
    oldest: [{ createdAt: "asc" }, { id: "asc" }],
    "name-asc": [{ name: "asc" }, { id: "asc" }],
    "name-desc": [{ name: "desc" }, { id: "asc" }],
    "price-asc": [{ price: "asc" }, { id: "asc" }],
    "price-desc": [{ price: "desc" }, { id: "asc" }],
  };

const LIST_SELECT = {
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
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

/**
 * Admin-only filtered/paginated product list backing the CRUD page. Always
 * priced (admins see money). Search matches name / sku / brand (insensitive).
 * By default excludes soft-deleted rows (Trash is a separate view).
 */
export async function listProductsAction(
  input: ListProductsInput = {},
): Promise<ActionResult<ListProductsResult>> {
  return guarded(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.PRODUCTS_VIEW);

    const params = listProductsInputSchema.parse(input);

    const where: Prisma.ProductWhereInput = {
      ...(params.includeDeleted ? {} : { deletedAt: null }),
      ...(params.categoryId ? { categoryId: params.categoryId } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.stockStatus ? { stockStatus: params.stockStatus } : {}),
    };

    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: "insensitive" } },
        { sku: { contains: params.search, mode: "insensitive" } },
        { brand: { contains: params.search, mode: "insensitive" } },
        { brandRef: { name: { contains: params.search, mode: "insensitive" } } },
      ];
    }

    const take = params.take;
    const skip = (params.page - 1) * take;

    const [rows, total] = await Promise.all([
      prisma.product.findMany({
        where,
        select: LIST_SELECT,
        orderBy: SORT_ORDER[params.sort],
        skip,
        take,
      }),
      prisma.product.count({ where }),
    ]);

    return {
      ok: true,
      products: rows.map((row) => toPricedProduct(row)),
      total,
      page: params.page,
      pageCount: Math.max(1, Math.ceil(total / take)),
    };
  });
}
