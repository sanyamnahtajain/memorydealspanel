"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { resolveViewer } from "@/server/auth/viewer";
import { assertAdmin, isForbiddenError } from "@/server/dal/guard";
import { assertPermission } from "@/server/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { writeAudit } from "@/server/security/audit";
import type {
  SaveVariantsInput,
  VariantsActionResult,
  EditorVariant,
} from "@/components/admin/products/variants/types";
import { entityStatusSchema, objectIdSchema } from "@/lib/schemas/shared";
import {
  createVariantSchema,
  optionTypesSchema,
  updateVariantSchema,
  type CreateVariantInput,
  type OptionTypesInput,
  type UpdateVariantInput,
} from "@/lib/schemas/variant";
import {
  saveProductVariants,
  deleteVariant,
  disableVariants,
  enableVariants,
  generateMatrix,
  isVariantServiceError,
  listVariants,
  setDefaultVariant,
  setOptionTypes,
  setVariantStatus,
  upsertVariant,
  type AdminVariant,
} from "@/server/services/variants";

/**
 * Admin product-variant server actions (PRD Phase 11).
 *
 * Every mutating action follows the product-action contract:
 *   1. resolveViewer() + assertAdmin(viewer)            — authorisation
 *   2. assertPermission(viewer, PRODUCTS_EDIT)          — RBAC
 *   3. zod validation of the input                      — never trust the client
 *   4. delegate to the variant service layer            — domain logic + invariants
 *   5. writeAudit(...)                                  — tamper-evident trail
 *   6. revalidatePath(...)                              — refresh RSC caches
 *
 * Nothing throws to the client: failures come back as a typed
 * `{ ok: false, error }`. Prices in the returned `AdminVariant` are admin-only —
 * these actions are gated to admins with PRODUCTS_EDIT, never customers.
 */

export type ActionResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const ACTOR = "admin" as const;

/** Wraps an action body so Forbidden / service / zod errors become results. */
async function guarded<T>(
  run: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (error) {
    if (isForbiddenError(error)) {
      return { ok: false, error: "You are not authorised to do that." };
    }
    if (isVariantServiceError(error)) {
      return { ok: false, error: error.message };
    }
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues[0]?.message ?? "Invalid input." };
    }
    console.error("[actions/variants] unexpected error:", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** Refreshes the admin editor + storefront caches for a product. */
function revalidateProductViews(productId: string): void {
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}`);
  // Storefront reads are viewer-gated but still cached per path.
  revalidatePath("/", "layout");
}

/**
 * Resolves an authorised admin viewer with PRODUCTS_EDIT. Shared by every
 * mutating action so the authorisation contract is identical everywhere.
 */
async function requireProductEditor() {
  const viewer = await resolveViewer();
  assertAdmin(viewer);
  await assertPermission(viewer, PERMISSIONS.PRODUCTS_EDIT);
  return viewer;
}

/* ------------------------------------------------------------------ */
/* option types                                                        */
/* ------------------------------------------------------------------ */

export async function setOptionTypesAction(
  productId: string,
  optionTypes: OptionTypesInput,
): Promise<ActionResult<{ optionTypes: OptionTypesInput }>> {
  return guarded(async () => {
    const viewer = await requireProductEditor();
    const id = objectIdSchema.parse(productId);
    const parsed = optionTypesSchema.parse(optionTypes);

    const saved = await setOptionTypes(id, parsed);

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "product.variant.optionTypes",
      entity: "Product",
      entityId: id,
      diff: { optionTypes: saved.map((t) => t.name) },
    });

    revalidateProductViews(id);
    return { ok: true, optionTypes: saved };
  });
}

/* ------------------------------------------------------------------ */
/* generate matrix                                                     */
/* ------------------------------------------------------------------ */

export async function generateMatrixAction(
  productId: string,
): Promise<ActionResult<{ variants: AdminVariant[] }>> {
  return guarded(async () => {
    const viewer = await requireProductEditor();
    const id = objectIdSchema.parse(productId);

    const variants = await generateMatrix(id);

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "product.variant.generateMatrix",
      entity: "Product",
      entityId: id,
      diff: { count: variants.length },
    });

    revalidateProductViews(id);
    return { ok: true, variants };
  });
}

/* ------------------------------------------------------------------ */
/* enable / disable                                                    */
/* ------------------------------------------------------------------ */

export async function enableVariantsAction(
  productId: string,
): Promise<ActionResult<{ variants: AdminVariant[] }>> {
  return guarded(async () => {
    const viewer = await requireProductEditor();
    const id = objectIdSchema.parse(productId);

    await enableVariants(id);
    const variants = await listVariants(id);

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "product.variant.enable",
      entity: "Product",
      entityId: id,
    });

    revalidateProductViews(id);
    return { ok: true, variants };
  });
}

export async function disableVariantsAction(
  productId: string,
): Promise<ActionResult<{ productId: string }>> {
  return guarded(async () => {
    const viewer = await requireProductEditor();
    const id = objectIdSchema.parse(productId);

    await disableVariants(id);

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "product.variant.disable",
      entity: "Product",
      entityId: id,
    });

    revalidateProductViews(id);
    return { ok: true, productId: id };
  });
}

/* ------------------------------------------------------------------ */
/* upsert / delete                                                     */
/* ------------------------------------------------------------------ */

export async function createVariantAction(
  productId: string,
  input: CreateVariantInput,
): Promise<ActionResult<{ variant: AdminVariant }>> {
  return guarded(async () => {
    const viewer = await requireProductEditor();
    const id = objectIdSchema.parse(productId);
    const data = createVariantSchema.parse(input);

    const variant = await upsertVariant(id, data);

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "product.variant.create",
      entity: "ProductVariant",
      entityId: variant.id,
      diff: { productId: id, sku: variant.sku, options: variant.optionValues },
    });

    revalidateProductViews(id);
    return { ok: true, variant };
  });
}

export async function updateVariantAction(
  productId: string,
  variantId: string,
  patch: UpdateVariantInput,
): Promise<ActionResult<{ variant: AdminVariant }>> {
  return guarded(async () => {
    const viewer = await requireProductEditor();
    const pid = objectIdSchema.parse(productId);
    const vid = objectIdSchema.parse(variantId);
    const data = updateVariantSchema.parse(patch);

    const variant = await upsertVariant(pid, { ...data, id: vid });

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "product.variant.update",
      entity: "ProductVariant",
      entityId: vid,
      diff: { productId: pid, changed: Object.keys(data) },
    });

    revalidateProductViews(pid);
    return { ok: true, variant };
  });
}

export async function deleteVariantAction(
  productId: string,
  variantId: string,
): Promise<ActionResult<{ variantId: string }>> {
  return guarded(async () => {
    const viewer = await requireProductEditor();
    const pid = objectIdSchema.parse(productId);
    const vid = objectIdSchema.parse(variantId);

    await deleteVariant(vid);

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "product.variant.delete",
      entity: "ProductVariant",
      entityId: vid,
      diff: { productId: pid },
    });

    revalidateProductViews(pid);
    return { ok: true, variantId: vid };
  });
}

/* ------------------------------------------------------------------ */
/* default / status                                                    */
/* ------------------------------------------------------------------ */

export async function setDefaultVariantAction(
  productId: string,
  variantId: string,
): Promise<ActionResult<{ variant: AdminVariant }>> {
  return guarded(async () => {
    const viewer = await requireProductEditor();
    const pid = objectIdSchema.parse(productId);
    const vid = objectIdSchema.parse(variantId);

    const variant = await setDefaultVariant(vid);

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "product.variant.setDefault",
      entity: "ProductVariant",
      entityId: vid,
      diff: { productId: pid },
    });

    revalidateProductViews(pid);
    return { ok: true, variant };
  });
}

export async function setVariantStatusAction(
  productId: string,
  variantId: string,
  status: unknown,
): Promise<ActionResult<{ variant: AdminVariant }>> {
  return guarded(async () => {
    const viewer = await requireProductEditor();
    const pid = objectIdSchema.parse(productId);
    const vid = objectIdSchema.parse(variantId);
    const nextStatus = entityStatusSchema.parse(status);

    const variant = await setVariantStatus(vid, nextStatus);

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "product.variant.status",
      entity: "ProductVariant",
      entityId: vid,
      diff: { productId: pid, status: nextStatus },
    });

    revalidateProductViews(pid);
    return { ok: true, variant };
  });
}

/* ---------------------------------------------------------------- */
/* Batched editor save (wires the product-editor variants section)  */
/* ---------------------------------------------------------------- */

/** Stable client key from a variant's option values. */
function variantKey(optionValues: Record<string, string>): string {
  return Object.keys(optionValues)
    .sort()
    .map((k) => `${k}=${optionValues[k]}`)
    .join("&");
}

/**
 * Persist the whole variants surface for a product in one call and echo the
 * canonical rows back in the editor's shape. This is the action injected into
 * ProductEditorForm's variants section (replaces the unwired placeholder).
 */
export async function saveProductVariantsAction(
  input: SaveVariantsInput,
): Promise<VariantsActionResult> {
  try {
    const viewer = await requireProductEditor();
    const productId = objectIdSchema.parse(input.productId);

    const { variants, fromPrice } = await saveProductVariants(productId, {
      hasVariants: input.hasVariants,
      optionTypes: input.optionTypes,
      variants: input.variants,
    });

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "product.variants.save",
      entity: "Product",
      entityId: productId,
      diff: { hasVariants: input.hasVariants, variantCount: variants.length },
    });
    revalidateProductViews(productId);

    const editorVariants: EditorVariant[] = variants.map((v) => ({
      id: v.id,
      key: variantKey(v.optionValues),
      optionValues: v.optionValues,
      sku: v.sku,
      price: v.price,
      mrp: v.mrp,
      moq: v.moq,
      stockStatus: v.stockStatus,
      status: v.status,
      isDefault: v.isDefault,
      sortOrder: v.sortOrder,
      imageCount: v.images.length,
    }));

    return {
      ok: true,
      variants: editorVariants,
      optionTypes: input.optionTypes,
      fromPrice,
    };
  } catch (error) {
    if (isForbiddenError(error)) {
      return { ok: false, error: "You are not allowed to edit variants." };
    }
    const message =
      error instanceof Error ? error.message : "Could not save variants.";
    return { ok: false, error: message };
  }
}
