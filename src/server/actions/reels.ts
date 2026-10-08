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
import { resetSwrCache } from "@/server/cache/swr";
import { objectIdSchema } from "@/lib/schemas/shared";
import { MAX_REELS, reelInputSchema } from "@/lib/reels";
import {
  ACCEPTED_VIDEO_MIME_TYPES,
  MAX_VIDEO_BYTES,
  rejectVideo,
  videoExtensionForType,
} from "@/lib/video";
import {
  countReels,
  createReel,
  deleteReel,
  reorderReels,
  searchProductsForReel,
  updateReel,
  type ReelProductPick,
} from "@/server/services/reels";

/**
 * Reel admin actions. Guarded by SETTINGS_MANAGE like banners — a reel is
 * store-wide presentation every visitor sees, so it sits with the other
 * shop-configuration powers rather than with catalogue editing.
 *
 * CACHE CONTRACT: the live read (`listLiveReels`) is memoised under the SWR
 * key "reels-live" AND rendered into the ISR home page. Every successful
 * write therefore clears both — otherwise an admin's change would take up to
 * a minute (SWR) plus five (ISR) to appear, which reads as "the save failed".
 */

export type ReelResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

function fail(error: string): ReelResult<never> {
  return { ok: false, error };
}

function toFailure(error: unknown, fallback: string): ReelResult<never> {
  if (isForbiddenError(error)) {
    return fail("You don't have permission to manage reels.");
  }
  if (error instanceof z.ZodError) {
    return fail(error.issues[0]?.message ?? fallback);
  }
  console.error("[reels] action failed:", error);
  return fail(fallback);
}

async function currentActor(): Promise<{ actorId: string }> {
  const viewer = await resolveViewer();
  assertAdmin(viewer);
  await assertPermission(viewer, PERMISSIONS.SETTINGS_MANAGE);
  return { actorId: viewer.adminId };
}

/** Clear the memoised live read and every page that renders it. */
function revalidateReelSurfaces(): void {
  resetSwrCache("reels-live");
  revalidatePath("/");
  revalidatePath("/reels");
  revalidatePath("/admin/reels");
}

/* ------------------------------------------------------------------ */
/* uploads                                                             */
/* ------------------------------------------------------------------ */

export interface UploadTargetResult {
  uploadUrl: string;
  publicUrl: string;
  headers: Record<string, string>;
}

const presignVideoSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(ACCEPTED_VIDEO_MIME_TYPES),
  size: z.number().int().positive().max(MAX_VIDEO_BYTES),
});

/**
 * Mint a direct-PUT target for the clip. The declared size is validated
 * against the ceiling in src/lib/video.ts HERE as well as in the dialog, so a
 * tampered client cannot presign an oversized clip. (The PUT itself is not
 * Content-Length-signed: that is the same posture as product videos today,
 * and it keeps the upload path identical to the one already proven in
 * production.)
 */
export async function presignReelUpload(
  filename: string,
  contentType: string,
  size: number,
): Promise<ReelResult<UploadTargetResult>> {
  try {
    await currentActor();
    // The shared rule first, for the same message the browser shows.
    const rejection = rejectVideo({ name: filename, type: contentType, size }, 0);
    if (rejection) return fail(rejection.message);
    const input = presignVideoSchema.parse({ filename, contentType, size });
    const ext = videoExtensionForType(input.contentType);
    const key = `reels/${randomUUID()}.${ext}`;
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

/** Same narrow list as banners — AVIF is left out for Safari's sake. */
const ACCEPTED_POSTER = ["image/jpeg", "image/png", "image/webp"] as const;

const presignPosterSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(ACCEPTED_POSTER),
});

export async function presignReelPosterUpload(
  filename: string,
  contentType: string,
): Promise<ReelResult<UploadTargetResult>> {
  try {
    await currentActor();
    const input = presignPosterSchema.parse({ filename, contentType });
    const ext = input.contentType.split("/")[1].replace("jpeg", "jpg");
    const key = `reels/posters/${randomUUID()}.${ext}`;
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

export async function saveReelAction(
  input: unknown,
  id?: string | null,
): Promise<ReelResult<{ id: string }>> {
  try {
    const { actorId } = await currentActor();
    const parsed = reelInputSchema.parse(input);

    if (!id) {
      const existing = await countReels();
      if (existing >= MAX_REELS) {
        return fail(
          `You already have ${MAX_REELS} reels. Remove one before adding another.`,
        );
      }
      const created = await createReel(parsed);
      await writeAudit({
        actorType: "admin",
        actorId,
        action: "reel.create",
        entity: "Reel",
        entityId: created.id,
        diff: {
          caption: created.caption,
          active: created.active,
          productId: created.productId,
        },
      });
      revalidateReelSurfaces();
      return { ok: true, id: created.id };
    }

    const reelId = objectIdSchema.parse(id);
    const updated = await updateReel(reelId, parsed);
    if (!updated) return fail("That reel no longer exists.");
    await writeAudit({
      actorType: "admin",
      actorId,
      action: "reel.update",
      entity: "Reel",
      entityId: reelId,
      diff: {
        caption: updated.caption,
        active: updated.active,
        productId: updated.productId,
      },
    });
    revalidateReelSurfaces();
    return { ok: true, id: reelId };
  } catch (error) {
    return toFailure(error, "Could not save the reel. Please try again.");
  }
}

export async function deleteReelAction(id: string): Promise<ReelResult> {
  try {
    const { actorId } = await currentActor();
    const reelId = objectIdSchema.parse(id);
    const removed = await deleteReel(reelId);
    if (!removed) return fail("That reel no longer exists.");
    await writeAudit({
      actorType: "admin",
      actorId,
      action: "reel.delete",
      entity: "Reel",
      entityId: reelId,
    });
    revalidateReelSurfaces();
    return { ok: true };
  } catch (error) {
    return toFailure(error, "Could not remove the reel. Please try again.");
  }
}

/** Persist a new display order (arrow reorder in the admin list). */
export async function reorderReelsAction(
  orderedIds: string[],
): Promise<ReelResult> {
  try {
    const { actorId } = await currentActor();
    const ids = z.array(objectIdSchema).min(1).max(MAX_REELS).parse(orderedIds);
    const touched = await reorderReels(ids);
    await writeAudit({
      actorType: "admin",
      actorId,
      action: "reel.reorder",
      entity: "Reel",
      entityId: "all",
      diff: { count: touched },
    });
    revalidateReelSurfaces();
    return { ok: true };
  } catch (error) {
    return toFailure(error, "Could not reorder the reels.");
  }
}

/* ------------------------------------------------------------------ */
/* product picker                                                      */
/* ------------------------------------------------------------------ */

const searchSchema = z.string().trim().max(80);

/**
 * Products for the "this reel sells…" picker. At most 8, active only,
 * price-free — the admin picks by name/SKU and the storefront reads the
 * price on the product page like everywhere else.
 */
export async function searchProductsForReelAction(
  query: string,
): Promise<ReelResult<{ products: ReelProductPick[] }>> {
  try {
    await currentActor();
    const q = searchSchema.parse(query);
    const products = await searchProductsForReel(q);
    return { ok: true, products };
  } catch (error) {
    return toFailure(error, "Search failed. Please try again.");
  }
}
