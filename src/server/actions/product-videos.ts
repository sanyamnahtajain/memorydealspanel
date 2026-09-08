"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ProductVideo } from "@prisma/client";

import { prisma } from "@/server/db";
import { resolveViewer } from "@/server/auth/viewer";
import { assertAdmin, isForbiddenError } from "@/server/dal/guard";
import { writeAudit } from "@/server/security/audit";
import { createUploadTarget } from "@/server/storage/r2";
import { objectIdSchema } from "@/lib/schemas/shared";
import {
  ACCEPTED_VIDEO_MIME_TYPES,
  MAX_VIDEOS_PER_PRODUCT,
  videoExtensionForType,
} from "@/lib/video";

/**
 * Product demo videos — presign, attach, remove.
 *
 * Deliberately its own module rather than more branches inside
 * actions/images.ts: videos share the storage plumbing but nothing else. They
 * have different accepted types, a different ceiling, no thumbnail pipeline
 * and no "primary" concept, and mixing the two would leave every image call
 * site carrying video branches it never takes.
 *
 * The upload itself goes BROWSER → R2 directly through a presigned PUT. The
 * bytes never pass through a serverless function, so a 30MB clip costs no
 * function time and cannot hit a request-body limit.
 */

export type VideoActionResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

function fail(error: string): VideoActionResult<never> {
  return { ok: false, error };
}

function toFailure(error: unknown, fallback: string): VideoActionResult<never> {
  if (isForbiddenError(error)) {
    return fail("You do not have permission to manage product videos.");
  }
  if (error instanceof z.ZodError) {
    return fail(error.issues[0]?.message ?? fallback);
  }
  console.error("[product-videos] action failed:", error);
  return fail(fallback);
}

async function currentActor(): Promise<{ actorId: string }> {
  const viewer = await resolveViewer();
  assertAdmin(viewer);
  return { actorId: viewer.adminId };
}

function revalidateProduct(productId: string, slug?: string | null): void {
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}`);
  if (slug) revalidatePath(`/p/${slug}`);
}

/** Load the live product's videos, or null when it does not exist. */
async function loadVideos(
  productId: string,
): Promise<{ videos: ProductVideo[]; slug: string } | null> {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { videos: true, slug: true },
  });
  if (!product) return null;
  return { videos: product.videos ?? [], slug: product.slug };
}

/* ------------------------------------------------------------------ */
/* presign                                                             */
/* ------------------------------------------------------------------ */

const presignSchema = z.object({
  productId: objectIdSchema,
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(ACCEPTED_VIDEO_MIME_TYPES),
});

export async function presignVideoUpload(
  productId: string,
  filename: string,
  contentType: string,
): Promise<
  VideoActionResult<{
    uploadUrl: string;
    publicUrl: string;
    headers: Record<string, string>;
  }>
> {
  try {
    await currentActor();
    const input = presignSchema.parse({ productId, filename, contentType });

    const existing = await loadVideos(input.productId);
    if (!existing) return fail("Product not found.");
    // Re-checked here, not just in the browser: the ceiling is only real if
    // the server enforces it.
    if (existing.videos.length >= MAX_VIDEOS_PER_PRODUCT) {
      return fail(
        `A product can have at most ${MAX_VIDEOS_PER_PRODUCT} videos.`,
      );
    }

    const ext = videoExtensionForType(input.contentType);
    const key = `products/${input.productId}/video-${randomUUID()}.${ext}`;
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
/* attach                                                              */
/* ------------------------------------------------------------------ */

const attachSchema = z.object({
  productId: objectIdSchema,
  // Only a URL we just minted may be attached — see the prefix check below.
  url: z.string().trim().min(1).max(2048),
  posterUrl: z.string().trim().max(2048).nullish(),
});

export async function attachProductVideo(
  productId: string,
  url: string,
  posterUrl?: string | null,
): Promise<VideoActionResult<{ videos: ProductVideo[] }>> {
  try {
    const { actorId } = await currentActor();
    const input = attachSchema.parse({ productId, url, posterUrl });

    const existing = await loadVideos(input.productId);
    if (!existing) return fail("Product not found.");
    if (existing.videos.length >= MAX_VIDEOS_PER_PRODUCT) {
      return fail(
        `A product can have at most ${MAX_VIDEOS_PER_PRODUCT} videos.`,
      );
    }
    // The URL must belong to THIS product's own upload prefix. Without this an
    // admin-shaped call could point a product's player at any URL on the
    // internet, which the storefront would then embed for every buyer.
    if (!input.url.includes(`products/${input.productId}/video-`)) {
      return fail("That file was not uploaded for this product.");
    }
    if (existing.videos.some((v) => v.url === input.url)) {
      return fail("That video is already attached.");
    }

    const videos: ProductVideo[] = [
      ...existing.videos,
      {
        url: input.url,
        posterUrl: input.posterUrl?.trim() ? input.posterUrl.trim() : null,
        sortOrder: existing.videos.length,
      },
    ];

    await prisma.product.update({
      where: { id: input.productId },
      data: { videos },
    });
    await writeAudit({
      actorType: "admin",
      actorId,
      action: "product.video.add",
      entity: "Product",
      entityId: input.productId,
      diff: { count: videos.length },
    });

    revalidateProduct(input.productId, existing.slug);
    return { ok: true, videos };
  } catch (error) {
    return toFailure(error, "Could not attach the video. Please try again.");
  }
}

/* ------------------------------------------------------------------ */
/* remove                                                              */
/* ------------------------------------------------------------------ */

const removeSchema = z.object({
  productId: objectIdSchema,
  url: z.string().trim().min(1).max(2048),
});

export async function removeProductVideo(
  productId: string,
  url: string,
): Promise<VideoActionResult<{ videos: ProductVideo[] }>> {
  try {
    const { actorId } = await currentActor();
    const input = removeSchema.parse({ productId, url });

    const existing = await loadVideos(input.productId);
    if (!existing) return fail("Product not found.");

    const videos = existing.videos
      .filter((v) => v.url !== input.url)
      // Re-number so the remaining clips stay a clean 0..n-1 sequence.
      .map((v, index) => ({ ...v, sortOrder: index }));

    if (videos.length === existing.videos.length) {
      return fail("That video is not attached to this product.");
    }

    await prisma.product.update({
      where: { id: input.productId },
      data: { videos },
    });
    await writeAudit({
      actorType: "admin",
      actorId,
      action: "product.video.remove",
      entity: "Product",
      entityId: input.productId,
      diff: { count: videos.length },
    });

    // The object itself is deliberately LEFT in storage: an admin who removes
    // a clip by accident can re-attach it, and orphaned objects are cheap
    // compared with deleting a file another record might still reference.
    revalidateProduct(input.productId, existing.slug);
    return { ok: true, videos };
  } catch (error) {
    return toFailure(error, "Could not remove the video. Please try again.");
  }
}
