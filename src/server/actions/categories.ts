"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createCategorySchema,
  updateCategorySchema,
} from "@/lib/schemas/category";
import { objectIdSchema, entityStatusSchema } from "@/lib/schemas/shared";
import { resolveViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { writeAudit } from "@/server/security/audit";
import { createUploadTarget, type UploadTarget } from "@/server/storage/r2";
import {
  createCategory,
  createSubCategory,
  deleteCategory,
  CategoryInUseError,
  reorderCategories,
  setCategoryStatus,
  updateCategory,
  type CategoryRecord,
} from "@/server/services/categories";

/**
 * "use server" action wrappers for category management.
 *
 * Every mutating action:
 *   1. resolves the viewer and requires admin (returns a typed error otherwise
 *      — never throws raw across the client boundary),
 *   2. validates input with the category zod schemas,
 *   3. delegates to the service layer,
 *   4. writes an audit entry and revalidates /admin/categories.
 */

const CATEGORIES_PATH = "/admin/categories";

export type ActionResult<T = void> = [T] extends [void]
  ? { ok: true } | { ok: false; error: string }
  : { ok: true; data: T } | { ok: false; error: string };

/** Resolves the admin viewer or returns a typed forbidden result. */
async function requireAdmin(): Promise<
  { ok: true; adminId: string } | { ok: false; error: string }
> {
  const viewer = await resolveViewer();
  if (!isAdmin(viewer)) {
    return { ok: false, error: "You must be signed in as an admin." };
  }
  return { ok: true, adminId: viewer.adminId };
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** Formats the first zod issue into a human-readable message. */
function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue?.message ?? "Invalid input.";
}

/* --------------------------------------------------------------------- */
/* Create                                                                */
/* --------------------------------------------------------------------- */

export async function createCategoryAction(
  input: unknown,
): Promise<ActionResult<CategoryRecord>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const parsed = createCategorySchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error));
  }

  try {
    const data = parsed.data;
    const category = data.parentId
      ? await createSubCategory(data.parentId, {
          name: data.name,
          image: data.image ?? null,
          sortOrder: data.sortOrder,
          status: data.status,
        })
      : await createCategory({
          name: data.name,
          image: data.image ?? null,
          sortOrder: data.sortOrder,
          status: data.status,
          parentId: null,
        });

    await writeAudit({
      actorType: "admin",
      actorId: auth.adminId,
      action: data.parentId ? "category.createSub" : "category.create",
      entity: "Category",
      entityId: category.id,
      diff: {
        name: category.name,
        slug: category.slug,
        parentId: category.parentId,
        status: category.status,
      },
    });

    revalidatePath(CATEGORIES_PATH);
    return { ok: true, data: category };
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to create category.",
    );
  }
}

/* --------------------------------------------------------------------- */
/* Update / rename / image                                               */
/* --------------------------------------------------------------------- */

const updateActionSchema = z.object({
  id: objectIdSchema,
  patch: updateCategorySchema,
});

export async function updateCategoryAction(
  input: unknown,
): Promise<ActionResult<CategoryRecord>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const parsed = updateActionSchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error));
  }

  try {
    const { id, patch } = parsed.data;
    const category = await updateCategory(id, patch);

    await writeAudit({
      actorType: "admin",
      actorId: auth.adminId,
      action: "category.update",
      entity: "Category",
      entityId: category.id,
      diff: { changed: Object.keys(patch), name: category.name },
    });

    revalidatePath(CATEGORIES_PATH);
    return { ok: true, data: category };
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to update category.",
    );
  }
}

/* --------------------------------------------------------------------- */
/* Reorder                                                               */
/* --------------------------------------------------------------------- */

const reorderActionSchema = z.object({
  ids: z.array(objectIdSchema).min(1, "Nothing to reorder."),
});

export async function reorderCategoriesAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const parsed = reorderActionSchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error));
  }

  try {
    await reorderCategories(parsed.data.ids);

    await writeAudit({
      actorType: "admin",
      actorId: auth.adminId,
      action: "category.reorder",
      entity: "Category",
      entityId: parsed.data.ids[0],
      diff: { order: parsed.data.ids },
    });

    revalidatePath(CATEGORIES_PATH);
    return { ok: true };
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to reorder categories.",
    );
  }
}

/* --------------------------------------------------------------------- */
/* Status toggle                                                         */
/* --------------------------------------------------------------------- */

const statusActionSchema = z.object({
  id: objectIdSchema,
  status: entityStatusSchema,
});

export async function setCategoryStatusAction(
  input: unknown,
): Promise<ActionResult<CategoryRecord>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const parsed = statusActionSchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error));
  }

  try {
    const category = await setCategoryStatus(parsed.data.id, parsed.data.status);

    await writeAudit({
      actorType: "admin",
      actorId: auth.adminId,
      action: "category.setStatus",
      entity: "Category",
      entityId: category.id,
      diff: { status: category.status },
    });

    revalidatePath(CATEGORIES_PATH);
    return { ok: true, data: category };
  } catch (error) {
    return fail(
      error instanceof Error
        ? error.message
        : "Failed to change category status.",
    );
  }
}

/* --------------------------------------------------------------------- */
/* Delete                                                                */
/* --------------------------------------------------------------------- */

const deleteActionSchema = z.object({ id: objectIdSchema });

export async function deleteCategoryAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const parsed = deleteActionSchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error));
  }

  try {
    await deleteCategory(parsed.data.id);

    await writeAudit({
      actorType: "admin",
      actorId: auth.adminId,
      action: "category.delete",
      entity: "Category",
      entityId: parsed.data.id,
    });

    revalidatePath(CATEGORIES_PATH);
    return { ok: true };
  } catch (error) {
    // CategoryInUseError carries a user-facing reason (products/children exist).
    return fail(
      error instanceof CategoryInUseError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Failed to delete category.",
    );
  }
}

/* --------------------------------------------------------------------- */
/* Image upload target                                                   */
/* --------------------------------------------------------------------- */

const uploadTargetSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z
    .string()
    .trim()
    .regex(/^image\/(png|jpe?g|webp|avif|gif)$/i, "Only image files are allowed."),
});

/**
 * Returns an env-aware upload target (presigned R2 in prod, local disk in dev)
 * for a category image. The client PUTs the file body to `uploadUrl` then
 * persists `publicUrl` on the category via `updateCategoryAction`.
 */
export async function createCategoryImageUploadTargetAction(
  input: unknown,
): Promise<ActionResult<UploadTarget>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const parsed = uploadTargetSchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error));
  }

  try {
    const ext = parsed.data.fileName.split(".").pop()?.toLowerCase() ?? "img";
    const key = `categories/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}.${ext}`;
    const target = await createUploadTarget(key, parsed.data.contentType);
    return { ok: true, data: target };
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to prepare upload.",
    );
  }
}
