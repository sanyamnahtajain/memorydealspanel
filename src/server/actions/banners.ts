"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { resolveViewer } from "@/server/auth/viewer";
import { assertAdmin, isForbiddenError } from "@/server/dal/guard";
import { assertPermission } from "@/server/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { writeAudit } from "@/server/security/audit";
import { createUploadTarget } from "@/server/storage/r2";
import { objectIdSchema } from "@/lib/schemas/shared";
import {
  bannerInputSchema,
  isBannerPlacement,
  type BannerPlacement,
} from "@/lib/banners";
import {
  MAX_BANNERS_PER_PLACEMENT,
  countBannersInPlacement,
  createBanner,
  deleteBanner,
  updateBanner,
} from "@/server/services/banners";

/**
 * Banner admin actions. Guarded by SETTINGS_MANAGE — a banner is store-wide
 * presentation that every visitor sees, so it sits with the other
 * shop-configuration powers rather than with catalogue editing.
 */

export type BannerResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

function fail(error: string): BannerResult<never> {
  return { ok: false, error };
}

function toFailure(error: unknown, fallback: string): BannerResult<never> {
  if (isForbiddenError(error)) {
    return fail("You don't have permission to manage banners.");
  }
  if (error instanceof z.ZodError) {
    return fail(error.issues[0]?.message ?? fallback);
  }
  console.error("[banners] action failed:", error);
  return fail(fallback);
}

async function currentActor(): Promise<{ actorId: string }> {
  const viewer = await resolveViewer();
  assertAdmin(viewer);
  await assertPermission(viewer, PERMISSIONS.SETTINGS_MANAGE);
  return { actorId: viewer.adminId };
}

/** Home is ISR-cached; a banner change must reach it without waiting out the TTL. */
function revalidateBannerSurfaces(): void {
  revalidatePath("/admin/banners");
  revalidatePath("/");
}

/* ------------------------------------------------------------------ */
/* image upload                                                        */
/* ------------------------------------------------------------------ */

const ACCEPTED_IMAGE = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const presignSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(ACCEPTED_IMAGE),
});

export async function presignBannerUpload(
  filename: string,
  contentType: string,
): Promise<
  BannerResult<{
    uploadUrl: string;
    publicUrl: string;
    headers: Record<string, string>;
  }>
> {
  try {
    await currentActor();
    const input = presignSchema.parse({ filename, contentType });
    const ext = input.contentType.split("/")[1].replace("jpeg", "jpg");
    const key = `banners/${randomUUID()}.${ext}`;
    const target = await createUploadTarget(key, input.contentType);
    return {
      ok: true,
      uploadUrl: target.uploadUrl,
      publicUrl: target.publicUrl,
      headers: target.headers,
    };
  } catch (error) {
    return toFailure(error, "Could not start the upload. Please try again.");
  }
}

/* ------------------------------------------------------------------ */
/* create / update / delete / reorder                                  */
/* ------------------------------------------------------------------ */

export async function saveBannerAction(
  id: string | null,
  input: unknown,
): Promise<BannerResult<{ id: string }>> {
  try {
    const { actorId } = await currentActor();
    const parsed = bannerInputSchema.parse(input);

    if (parsed.startsAt && parsed.endsAt && parsed.endsAt <= parsed.startsAt) {
      // Caught here rather than left to produce a banner that can never show.
      return fail("The end date must be after the start date.");
    }

    if (id === null) {
      const existing = await countBannersInPlacement(
        parsed.placement as BannerPlacement,
      );
      if (existing >= MAX_BANNERS_PER_PLACEMENT) {
        return fail(
          `That slot already has ${MAX_BANNERS_PER_PLACEMENT} banners. Remove one first.`,
        );
      }
      const created = await createBanner(parsed);
      await writeAudit({
        actorType: "admin",
        actorId,
        action: "banner.create",
        entity: "Banner",
        entityId: created.id,
        diff: { placement: created.placement, active: created.active },
      });
      revalidateBannerSurfaces();
      return { ok: true, id: created.id };
    }

    const bannerId = objectIdSchema.parse(id);
    const updated = await updateBanner(bannerId, parsed);
    if (!updated) return fail("That banner no longer exists.");
    await writeAudit({
      actorType: "admin",
      actorId,
      action: "banner.update",
      entity: "Banner",
      entityId: bannerId,
      diff: { placement: updated.placement, active: updated.active },
    });
    revalidateBannerSurfaces();
    return { ok: true, id: bannerId };
  } catch (error) {
    return toFailure(error, "Could not save the banner. Please try again.");
  }
}

export async function deleteBannerAction(
  id: string,
): Promise<BannerResult> {
  try {
    const { actorId } = await currentActor();
    const bannerId = objectIdSchema.parse(id);
    const removed = await deleteBanner(bannerId);
    if (!removed) return fail("That banner no longer exists.");
    await writeAudit({
      actorType: "admin",
      actorId,
      action: "banner.delete",
      entity: "Banner",
      entityId: bannerId,
    });
    revalidateBannerSurfaces();
    return { ok: true };
  } catch (error) {
    return toFailure(error, "Could not remove the banner. Please try again.");
  }
}

/** Persist a new order for one slot (drag/reorder in the admin list). */
export async function reorderBannersAction(
  placement: string,
  orderedIds: string[],
): Promise<BannerResult> {
  try {
    const { actorId } = await currentActor();
    if (!isBannerPlacement(placement)) return fail("Unknown banner slot.");
    const ids = z.array(objectIdSchema).max(MAX_BANNERS_PER_PLACEMENT).parse(orderedIds);

    // Sequential, not a transaction: MongoDB here has no multi-document
    // transaction guarantee worth relying on, and a half-applied reorder is
    // cosmetic — the next save fixes it. Nothing about money depends on it.
    for (const [index, id] of ids.entries()) {
      await updateBannerSortOrder(id, placement, index);
    }

    await writeAudit({
      actorType: "admin",
      actorId,
      action: "banner.reorder",
      entity: "Banner",
      entityId: placement,
      diff: { count: ids.length },
    });
    revalidateBannerSurfaces();
    return { ok: true };
  } catch (error) {
    return toFailure(error, "Could not reorder the banners.");
  }
}

async function updateBannerSortOrder(
  id: string,
  placement: string,
  sortOrder: number,
): Promise<void> {
  const { prisma } = await import("@/server/db");
  await prisma.banner.updateMany({
    where: { id, placement, deletedAt: null },
    data: { sortOrder },
  });
}
