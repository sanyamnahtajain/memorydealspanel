"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createBrandSchema,
  updateBrandActionSchema,
  setBrandStatusActionSchema,
  deleteBrandActionSchema,
  brandLogoUploadTargetSchema,
} from "@/lib/schemas/brand";
import { resolveViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { can } from "@/server/auth/require-permission";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import { writeAudit } from "@/server/security/audit";
import { resetSwrCache } from "@/server/cache/swr";
import { prisma } from "@/server/db";
import { brandPageInputSchema } from "@/lib/brand-layout";
import { createUploadTarget, type UploadTarget } from "@/server/storage/r2";
import {
  createBrand,
  deleteBrand,
  reorderBrands,
  setBrandStatus,
  updateBrand,
  BrandInUseError,
  type BrandRecord,
} from "@/server/services/brands";

/**
 * "use server" action wrappers for brand management.
 *
 * Every mutating action:
 *   1. resolves the viewer and requires admin + BRANDS_MANAGE (returns a typed
 *      error otherwise — never throws raw across the client boundary),
 *   2. validates input with the brand zod schemas (defined in
 *      @/lib/schemas/brand — a "use server" file may export only async fns),
 *   3. delegates to the service layer,
 *   4. writes an audit entry and revalidates /admin/brands.
 */

const BRANDS_PATH = "/admin/brands";

export type ActionResult<T = void> = [T] extends [void]
  ? { ok: true } | { ok: false; error: string }
  : { ok: true; data: T } | { ok: false; error: string };

/**
 * Resolves the admin viewer and requires an RBAC permission, returning a typed
 * forbidden result rather than throwing. Owner ("*") passes every permission,
 * so the seeded admin is unaffected.
 */
async function requireAdmin(
  permission: Permission,
): Promise<{ ok: true; adminId: string } | { ok: false; error: string }> {
  const viewer = await resolveViewer();
  if (!isAdmin(viewer)) {
    return { ok: false, error: "You must be signed in as an admin." };
  }
  if (!(await can(viewer, permission))) {
    return { ok: false, error: "You are not authorised to do that." };
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

export async function createBrandAction(
  input: unknown,
): Promise<ActionResult<BrandRecord>> {
  const auth = await requireAdmin(PERMISSIONS.BRANDS_MANAGE);
  if (!auth.ok) return auth;

  const parsed = createBrandSchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error));
  }

  try {
    const data = parsed.data;
    const brand = await createBrand({
      name: data.name,
      logo: data.logo ?? null,
      sortOrder: data.sortOrder,
      status: data.status,
    });

    await writeAudit({
      actorType: "admin",
      actorId: auth.adminId,
      action: "brand.create",
      entity: "Brand",
      entityId: brand.id,
      diff: { name: brand.name, slug: brand.slug, status: brand.status },
    });

    revalidatePath(BRANDS_PATH);
    return { ok: true, data: brand };
  } catch (error) {
    return fail(
      error instanceof BrandInUseError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Failed to create brand.",
    );
  }
}

/* --------------------------------------------------------------------- */
/* Update / rename / logo                                                */
/* --------------------------------------------------------------------- */

export async function updateBrandAction(
  input: unknown,
): Promise<ActionResult<BrandRecord>> {
  const auth = await requireAdmin(PERMISSIONS.BRANDS_MANAGE);
  if (!auth.ok) return auth;

  const parsed = updateBrandActionSchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error));
  }

  try {
    const { id, patch } = parsed.data;
    const brand = await updateBrand(id, patch);

    await writeAudit({
      actorType: "admin",
      actorId: auth.adminId,
      action: "brand.update",
      entity: "Brand",
      entityId: brand.id,
      diff: { changed: Object.keys(patch), name: brand.name },
    });

    revalidatePath(BRANDS_PATH);
    return { ok: true, data: brand };
  } catch (error) {
    return fail(
      error instanceof BrandInUseError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Failed to update brand.",
    );
  }
}

/* --------------------------------------------------------------------- */
/* Status toggle                                                         */
/* --------------------------------------------------------------------- */

export async function setBrandStatusAction(
  input: unknown,
): Promise<ActionResult<BrandRecord>> {
  const auth = await requireAdmin(PERMISSIONS.BRANDS_MANAGE);
  if (!auth.ok) return auth;

  const parsed = setBrandStatusActionSchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error));
  }

  try {
    const brand = await setBrandStatus(parsed.data.id, parsed.data.status);

    await writeAudit({
      actorType: "admin",
      actorId: auth.adminId,
      action: "brand.setStatus",
      entity: "Brand",
      entityId: brand.id,
      diff: { status: brand.status },
    });

    revalidatePath(BRANDS_PATH);
    return { ok: true, data: brand };
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to change brand status.",
    );
  }
}

/* --------------------------------------------------------------------- */
/* Delete                                                                */
/* --------------------------------------------------------------------- */

export async function deleteBrandAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await requireAdmin(PERMISSIONS.BRANDS_MANAGE);
  if (!auth.ok) return auth;

  const parsed = deleteBrandActionSchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error));
  }

  try {
    await deleteBrand(parsed.data.id);

    await writeAudit({
      actorType: "admin",
      actorId: auth.adminId,
      action: "brand.delete",
      entity: "Brand",
      entityId: parsed.data.id,
    });

    revalidatePath(BRANDS_PATH);
    return { ok: true };
  } catch (error) {
    // BrandInUseError carries a user-facing reason (products still reference it).
    return fail(
      error instanceof BrandInUseError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Failed to delete brand.",
    );
  }
}

/* --------------------------------------------------------------------- */
/* Logo upload target                                                    */
/* --------------------------------------------------------------------- */

/**
 * Returns an env-aware upload target (presigned R2 in prod, local disk in dev)
 * for a brand logo. The client PUTs the file body to `uploadUrl` then persists
 * `publicUrl` on the brand via `updateBrandAction`.
 */
export async function createBrandLogoUploadTargetAction(
  input: unknown,
): Promise<ActionResult<UploadTarget>> {
  const auth = await requireAdmin(PERMISSIONS.BRANDS_MANAGE);
  if (!auth.ok) return auth;

  const parsed = brandLogoUploadTargetSchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error));
  }

  try {
    const ext = parsed.data.fileName.split(".").pop()?.toLowerCase() ?? "img";
    const key = `brands/${Date.now()}-${Math.random()
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

/* --------------------------------------------------------------------- */
/* Brand page (cover, tagline, home position, per-brand category rail)   */
/* --------------------------------------------------------------------- */

/**
 * Save the owner's brand-page setup in one write: cover artwork, tagline,
 * position among brands (home + directory), and the category rail — order,
 * brand-specific photo, display name and hidden flag per category. Validated
 * by the shared schema in src/lib/brand-layout.ts; the storefront re-parses
 * defensively on read, so even a bad row could never break the page.
 */
export async function saveBrandPageAction(
  input: unknown,
): Promise<ActionResult<{ slug: string }>> {
  const auth = await requireAdmin(PERMISSIONS.BRANDS_MANAGE);
  if (!auth.ok) return auth;

  const parsed = brandPageInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error));
  }
  const data = parsed.data;

  try {
    const brand = await prisma.brand.update({
      where: { id: data.brandId },
      data: {
        coverImage: data.coverImage || null,
        tagline: data.tagline || null,
        categoryOrderCustom: data.orderCustom === true,
        categoryLayout: data.layout.map((entry) => ({
          categoryId: entry.categoryId,
          image: entry.image || null,
          label: entry.label || null,
          hidden: entry.hidden,
        })),
      },
      select: { id: true, slug: true, name: true },
    });

    await writeAudit({
      actorType: "admin",
      actorId: auth.adminId,
      action: "brand.page",
      entity: "Brand",
      entityId: brand.id,
      diff: {
        name: brand.name,
        categories: data.layout.length,
        hidden: data.layout.filter((e) => e.hidden).length,
        cover: Boolean(data.coverImage),
      },
    });

    // The home bundle carries the brand order; the brand page reads the
    // layout per request (applied after its cached category read).
    resetSwrCache("home-data");
    resetSwrCache(`brand-cats:${brand.id}`);
    revalidatePath(BRANDS_PATH);
    revalidatePath(`/b/${brand.slug}`);
    revalidatePath("/brands");
    revalidatePath("/");
    return { ok: true, data: { slug: brand.slug } };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to save the brand page.");
  }
}

/* --------------------------------------------------------------------- */
/* Arrange (the order brands show on home and the brand directory)       */
/* --------------------------------------------------------------------- */

const reorderBrandsSchema = z.object({
  ids: z
    .array(z.string().regex(/^[a-f0-9]{24}$/i, "Invalid brand."))
    .min(1, "Nothing to reorder.")
    .max(500),
});

export async function reorderBrandsAction(input: unknown): Promise<ActionResult> {
  const auth = await requireAdmin(PERMISSIONS.BRANDS_MANAGE);
  if (!auth.ok) return auth;

  const parsed = reorderBrandsSchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error));
  }
  if (new Set(parsed.data.ids).size !== parsed.data.ids.length) {
    return fail("A brand appears twice in the order.");
  }

  try {
    await reorderBrands(parsed.data.ids);
    await writeAudit({
      actorType: "admin",
      actorId: auth.adminId,
      action: "brand.reorder",
      entity: "Brand",
      entityId: parsed.data.ids[0],
      diff: { order: parsed.data.ids },
    });
    resetSwrCache("home-data");
    revalidatePath(BRANDS_PATH);
    revalidatePath("/brands");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to save the brand order.");
  }
}
