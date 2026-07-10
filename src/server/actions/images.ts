"use server";

/**
 * Product image mutations — the write half of the image pipeline.
 *
 * Every action here is an admin-only Server Action that (1) resolves the
 * viewer and asserts admin, (2) validates its input with a zod schema, and
 * (3) writes an audit entry, returning a typed `ImageActionResult` rather
 * than throwing to the client.
 *
 * Upload flow: the browser calls `presignUpload` to obtain a target (a
 * presigned R2 PUT URL, or a local dev route), PUTs/POSTs the compressed
 * blob to it, then calls `attachImageToProduct` with the resulting public
 * URL to persist the embedded `ProductImage`.
 *
 * `Product.images` is an embedded array of the `ProductImage` composite type,
 * so every ordering/primary/removal operation reads the current array,
 * transforms it, and writes the whole array back (there is no per-element
 * Mongo update through Prisma for embedded composites).
 */

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ProductImage } from "@prisma/client";
import { prisma } from "@/server/db";
import { resolveViewer } from "@/server/auth/viewer";
import { assertAdmin, isForbiddenError } from "@/server/dal/guard";
import { writeAudit } from "@/server/security/audit";
import { createUploadTarget, type UploadTarget } from "@/server/storage/r2";
import { objectIdSchema } from "@/lib/schemas/shared";
import {
  ACCEPTED_IMAGE_MIME_TYPES,
  MAX_IMAGES_PER_PRODUCT,
} from "@/lib/constants";
import { extensionForType } from "@/lib/image";

// ---------------------------------------------------------------------------
// Result envelope
// ---------------------------------------------------------------------------

/** Discriminated result — actions never throw raw errors to the client. */
export type ImageActionResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

function ok<T>(data: T): ImageActionResult<T> {
  return { ok: true, ...data };
}

function fail(error: string): ImageActionResult<never> {
  return { ok: false, error };
}

/** Map a thrown error to a typed failure without leaking internals. */
function toFailure(error: unknown, fallback: string): ImageActionResult<never> {
  if (isForbiddenError(error)) {
    return fail("You do not have permission to manage product images.");
  }
  if (error instanceof z.ZodError) {
    return fail(error.issues[0]?.message ?? fallback);
  }
  console.error("[images] action failed:", error);
  return fail(fallback);
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

/**
 * A stored image URL: either an absolute http(s) URL (R2 / presigned mode)
 * or an app-relative `/uploads/...` path (local dev fallback). The shared
 * `productImageSchema` only accepts absolute URLs, so image inputs use this
 * looser, storage-aware validator instead.
 */
const storedUrlSchema = z
  .string()
  .trim()
  .min(1, "url is required")
  .max(2048, "url is too long")
  .refine(
    (value) => /^https?:\/\//i.test(value) || value.startsWith("/uploads/"),
    "url must be an absolute http(s) URL or an /uploads path",
  );

const attachInputSchema = z.object({
  url: storedUrlSchema,
  thumbUrl: storedUrlSchema.optional(),
  isPrimary: z.boolean().optional(),
});

export type AttachImageInput = z.infer<typeof attachInputSchema>;

const contentTypeSchema = z.enum(ACCEPTED_IMAGE_MIME_TYPES);

const presignInputSchema = z.object({
  productId: objectIdSchema,
  filename: z.string().trim().min(1).max(255),
  contentType: contentTypeSchema,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Re-render every surface that renders product images. */
function revalidateProduct(productId: string): void {
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath("/(store)", "layout");
}

/** Load the current embedded image array for a live (non-deleted) product. */
async function loadImages(
  productId: string,
): Promise<ProductImage[] | null> {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { images: true },
  });
  return product ? product.images : null;
}

/**
 * Re-derive `sortOrder` from array position and guarantee exactly one
 * primary image (the first, if none is flagged). Keeps the stored array
 * canonical after every mutation.
 */
function normalizeImages(images: ProductImage[]): ProductImage[] {
  if (images.length === 0) {
    return [];
  }
  let primaryIndex = images.findIndex((image) => image.isPrimary);
  if (primaryIndex === -1) {
    primaryIndex = 0;
  }
  return images.map((image, index) => ({
    url: image.url,
    thumbUrl: image.thumbUrl ?? null,
    sortOrder: index,
    isPrimary: index === primaryIndex,
  }));
}

/** Persist the normalized array and revalidate. Returns the stored array. */
async function persistImages(
  productId: string,
  images: ProductImage[],
): Promise<ProductImage[]> {
  const normalized = normalizeImages(images);
  await prisma.product.update({
    where: { id: productId },
    data: { images: { set: normalized } },
  });
  revalidateProduct(productId);
  return normalized;
}

async function currentActor(): Promise<{ actorId: string }> {
  const viewer = await resolveViewer();
  assertAdmin(viewer);
  return { actorId: viewer.adminId };
}

// ---------------------------------------------------------------------------
// presignUpload
// ---------------------------------------------------------------------------

/**
 * Produce an upload target for a single product image. The returned
 * `publicUrl` is the URL the client passes back to `attachImageToProduct`
 * once the blob has been PUT/POSTed to `uploadUrl`.
 *
 * The storage key is stable and namespaced: `products/{productId}/{uuid}.{ext}`.
 */
export async function presignUpload(
  productId: string,
  filename: string,
  contentType: string,
): Promise<
  ImageActionResult<{
    mode: UploadTarget["mode"];
    uploadUrl: string;
    publicUrl: string;
    headers: Record<string, string>;
    key: string;
  }>
> {
  try {
    await currentActor();
    const input = presignInputSchema.parse({ productId, filename, contentType });

    // Confirm the product exists and isn't soft-deleted before minting a key.
    const product = await prisma.product.findFirst({
      where: { id: input.productId, deletedAt: null },
      select: { id: true },
    });
    if (!product) {
      return fail("Product not found.");
    }

    const ext = extensionForType(input.contentType);
    const key = `products/${input.productId}/${randomUUID()}.${ext}`;
    const target = await createUploadTarget(key, input.contentType);

    return ok({
      mode: target.mode,
      uploadUrl: target.uploadUrl,
      publicUrl: target.publicUrl,
      headers: target.headers,
      key,
    });
  } catch (error) {
    return toFailure(error, "Could not start the upload. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// attachImageToProduct
// ---------------------------------------------------------------------------

/**
 * Append an uploaded image to a product's embedded image array. Enforces the
 * per-product cap, appends at the end (highest sortOrder), and — if this is
 * the first image or `isPrimary` is requested — makes it the primary image.
 */
export async function attachImageToProduct(
  productId: string,
  image: AttachImageInput,
): Promise<ImageActionResult<{ images: ProductImage[] }>> {
  try {
    const { actorId } = await currentActor();
    const id = objectIdSchema.parse(productId);
    const input = attachInputSchema.parse(image);

    const existing = await loadImages(id);
    if (existing === null) {
      return fail("Product not found.");
    }
    if (existing.length >= MAX_IMAGES_PER_PRODUCT) {
      return fail(
        `This product already has the maximum of ${MAX_IMAGES_PER_PRODUCT} images.`,
      );
    }
    if (existing.some((img) => img.url === input.url)) {
      return fail("That image has already been added to this product.");
    }

    const makePrimary = input.isPrimary === true || existing.length === 0;
    const next: ProductImage[] = [
      ...existing.map((img) => ({
        ...img,
        isPrimary: makePrimary ? false : img.isPrimary,
      })),
      {
        url: input.url,
        thumbUrl: input.thumbUrl ?? null,
        sortOrder: existing.length,
        isPrimary: makePrimary,
      },
    ];

    const images = await persistImages(id, next);
    await writeAudit({
      actorType: "admin",
      actorId,
      action: "product.image.attach",
      entity: "Product",
      entityId: id,
      diff: { url: input.url, isPrimary: makePrimary, count: images.length },
    });
    return ok({ images });
  } catch (error) {
    return toFailure(error, "Could not attach the image. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// removeImage
// ---------------------------------------------------------------------------

/** Remove an image by its stored URL. Re-derives ordering and primary. */
export async function removeImage(
  productId: string,
  url: string,
): Promise<ImageActionResult<{ images: ProductImage[] }>> {
  try {
    const { actorId } = await currentActor();
    const id = objectIdSchema.parse(productId);
    const target = storedUrlSchema.parse(url);

    const existing = await loadImages(id);
    if (existing === null) {
      return fail("Product not found.");
    }
    const next = existing.filter((img) => img.url !== target);
    if (next.length === existing.length) {
      return fail("That image is not attached to this product.");
    }

    const images = await persistImages(id, next);
    await writeAudit({
      actorType: "admin",
      actorId,
      action: "product.image.remove",
      entity: "Product",
      entityId: id,
      diff: { url: target, count: images.length },
    });
    return ok({ images });
  } catch (error) {
    return toFailure(error, "Could not remove the image. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// reorderImages
// ---------------------------------------------------------------------------

/**
 * Reorder a product's images to match `urlsInOrder`. The list must be a
 * permutation of the currently-stored URLs (no additions or removals);
 * `sortOrder` is re-derived from the new positions and the primary flag is
 * preserved on its image.
 */
export async function reorderImages(
  productId: string,
  urlsInOrder: string[],
): Promise<ImageActionResult<{ images: ProductImage[] }>> {
  try {
    const { actorId } = await currentActor();
    const id = objectIdSchema.parse(productId);
    const urls = z.array(storedUrlSchema).parse(urlsInOrder);

    const existing = await loadImages(id);
    if (existing === null) {
      return fail("Product not found.");
    }

    if (urls.length !== existing.length) {
      return fail("The image order must include every image exactly once.");
    }
    const byUrl = new Map(existing.map((img) => [img.url, img]));
    const reordered: ProductImage[] = [];
    for (const url of urls) {
      const img = byUrl.get(url);
      if (!img || reordered.includes(img)) {
        return fail("The image order does not match this product's images.");
      }
      reordered.push(img);
    }

    const images = await persistImages(id, reordered);
    await writeAudit({
      actorType: "admin",
      actorId,
      action: "product.image.reorder",
      entity: "Product",
      entityId: id,
      diff: { order: urls },
    });
    return ok({ images });
  } catch (error) {
    return toFailure(error, "Could not reorder the images. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// setPrimaryImage
// ---------------------------------------------------------------------------

/** Mark the image with `url` as primary; all others become non-primary. */
export async function setPrimaryImage(
  productId: string,
  url: string,
): Promise<ImageActionResult<{ images: ProductImage[] }>> {
  try {
    const { actorId } = await currentActor();
    const id = objectIdSchema.parse(productId);
    const target = storedUrlSchema.parse(url);

    const existing = await loadImages(id);
    if (existing === null) {
      return fail("Product not found.");
    }
    if (!existing.some((img) => img.url === target)) {
      return fail("That image is not attached to this product.");
    }

    const next = existing.map((img) => ({
      ...img,
      isPrimary: img.url === target,
    }));

    const images = await persistImages(id, next);
    await writeAudit({
      actorType: "admin",
      actorId,
      action: "product.image.setPrimary",
      entity: "Product",
      entityId: id,
      diff: { url: target },
    });
    return ok({ images });
  } catch (error) {
    return toFailure(error, "Could not set the primary image. Please try again.");
  }
}
