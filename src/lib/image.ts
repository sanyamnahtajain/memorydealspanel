/**
 * Client-side image helpers for the product photo pipeline.
 *
 * All work here happens in the browser BEFORE upload: we validate the raw
 * file against the product constraints (F-A10), compress the full-size image,
 * and derive a small square-ish thumbnail. The compressed blobs are then
 * handed to the upload pipeline (presign -> PUT/POST -> attach).
 *
 * `browser-image-compression` runs the heavy resize/encode work in a Web
 * Worker, so the UI thread stays responsive while a batch is processed.
 */

import imageCompression from "browser-image-compression";
import {
  ACCEPTED_IMAGE_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  MAX_IMAGES_PER_PRODUCT,
} from "./constants";

export {
  ACCEPTED_IMAGE_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  MAX_IMAGES_PER_PRODUCT,
};

/*
 * SIZE AND QUALITY BUDGETS.
 *
 * These numbers decide what a buyer actually sees, because `images.unoptimized`
 * is on in next.config.ts — what leaves this file is what gets served. There
 * is no second chance to re-encode later: the original never leaves the
 * browser, so an image compressed too hard here is permanently soft.
 *
 * The old budgets (1600px/0.5MB full, 400px/0.1MB thumb) were set to protect
 * an image-optimisation quota that no longer applies, and they were visibly
 * too tight:
 *
 *  - A 400px thumbnail is UPSCALED in every card it appears in. A grid card is
 *    ~45vw on a phone and ~22vw on a desktop — roughly 580 and 630 device
 *    pixels once screen density is counted. The card was being handed 400.
 *  - 0.5 MB for a 1600x1600 detail photo lands around JPEG quality 60, and the
 *    product gallery lets buyers ZOOM it, which is exactly where those
 *    artifacts show.
 *
 * `initialQuality` matters as much as the byte budget: without it
 * browser-image-compression starts at 0.7 and re-encodes at that quality even
 * when the file would have fit comfortably at 0.9. Starting high and letting
 * the size budget step it down only if needed is strictly better.
 */

/** Full-size longest-edge cap, in pixels. Covers a full-width retina zoom. */
const FULL_MAX_DIMENSION = 2000;
/** Full-size target byte budget after compression, in megabytes. */
const FULL_MAX_SIZE_MB = 1.5;
/** Encoder quality to start from before the size budget forces it down. */
const FULL_INITIAL_QUALITY = 0.92;
/** Thumbnail longest-edge cap, in pixels — 2x the largest card we render. */
const THUMB_MAX_DIMENSION = 800;
/** Thumbnail target byte budget after compression, in megabytes. */
const THUMB_MAX_SIZE_MB = 0.22;
/** Thumbnails can start slightly lower; they are never zoomed. */
const THUMB_INITIAL_QUALITY = 0.85;

/*
 * Banner artwork is a different problem from a product photo. It is WIDE, it
 * is never zoomed, and it is the home page's LCP element — the single image
 * whose arrival decides how fast the shop feels. So it gets a generous
 * dimension (a 3:1 strip needs the width) on a tight byte budget, rather than
 * the product photo's 1.5 MB.
 */
const BANNER_MAX_DIMENSION = 1800;
const BANNER_MAX_SIZE_MB = 0.4;
const BANNER_INITIAL_QUALITY = 0.85;

/** A validation/compression failure that carries a user-facing message. */
export class ImageError extends Error {
  readonly code = "IMAGE_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "ImageError";
    Object.setPrototypeOf(this, ImageError.prototype);
  }
}

/** True when the MIME type is one we accept for product images. */
export function isAcceptedImageType(type: string): boolean {
  return (ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(type);
}

/** The `accept` attribute value for a file input restricted to our types. */
export const IMAGE_ACCEPT_ATTR = ACCEPTED_IMAGE_MIME_TYPES.join(",");

/** Human-readable megabytes for messages, e.g. "5 MB". */
function mb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * Validate a raw picked file against type and pre-compression size limits.
 * Throws {@link ImageError} with a user-facing message on failure.
 */
export function assertValidImageFile(file: File): void {
  if (!isAcceptedImageType(file.type)) {
    throw new ImageError(
      `"${file.name}" is not a supported image type (JPEG, PNG, WebP or AVIF).`,
    );
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new ImageError(
      `"${file.name}" is ${mb(file.size)} — larger than the ${mb(
        MAX_IMAGE_SIZE_BYTES,
      )} limit.`,
    );
  }
}

/**
 * Guard the per-product image cap (F-A10). Given how many images the product
 * already has and how many are being added, throws if the total would exceed
 * {@link MAX_IMAGES_PER_PRODUCT}.
 */
export function assertWithinImageCap(existingCount: number, adding: number): void {
  if (existingCount + adding > MAX_IMAGES_PER_PRODUCT) {
    const remaining = Math.max(0, MAX_IMAGES_PER_PRODUCT - existingCount);
    throw new ImageError(
      remaining === 0
        ? `This product already has the maximum of ${MAX_IMAGES_PER_PRODUCT} images.`
        : `Only ${remaining} more image${remaining === 1 ? "" : "s"} can be added (max ${MAX_IMAGES_PER_PRODUCT}).`,
    );
  }
}

/**
 * Derive the output filename for a compressed blob, forcing a stable
 * extension so the storage key / content type stay consistent.
 */
function withExtension(name: string, ext: string): string {
  const base = name.replace(/\.[^./\\]+$/, "");
  return `${base || "image"}.${ext}`;
}

/**
 * Compress a full-size product image: longest edge <= FULL_MAX_DIMENSION,
 * target <= FULL_MAX_SIZE_MB. Preserves the source MIME type
 * (JPEG/PNG/WebP/AVIF). Returns a new `File` — the original is never mutated.
 */
export async function compressImage(file: File): Promise<File> {
  assertValidImageFile(file);
  try {
    const compressed = await imageCompression(file, {
      maxWidthOrHeight: FULL_MAX_DIMENSION,
      maxSizeMB: FULL_MAX_SIZE_MB,
      initialQuality: FULL_INITIAL_QUALITY,
      useWebWorker: true,
      fileType: file.type,
      // Only shrink — never upscale a small source.
      alwaysKeepResolution: false,
    });
    return normalizeCompressed(compressed, file);
  } catch (error) {
    throw new ImageError(
      `Could not process "${file.name}": ${
        error instanceof Error ? error.message : "compression failed"
      }`,
    );
  }
}

/**
 * Compress banner artwork. Wide enough for a full-bleed promo strip, light
 * enough to be the first thing a phone downloads. See the budget note above.
 */
export async function compressBannerArtwork(file: File): Promise<File> {
  assertValidImageFile(file);
  try {
    const compressed = await imageCompression(file, {
      maxWidthOrHeight: BANNER_MAX_DIMENSION,
      maxSizeMB: BANNER_MAX_SIZE_MB,
      initialQuality: BANNER_INITIAL_QUALITY,
      useWebWorker: true,
      fileType: file.type,
      alwaysKeepResolution: false,
    });
    return normalizeCompressed(compressed, file);
  } catch (error) {
    throw new ImageError(
      `Could not process "${file.name}": ${
        error instanceof Error ? error.message : "compression failed"
      }`,
    );
  }
}

/**
 * Produce a thumbnail (longest edge <= THUMB_MAX_DIMENSION) from the source
 * file. Used for the storefront grid / admin strip so we don't ship full-size
 * images into lists. Returns a new `File`.
 */
export async function makeThumbnail(file: File): Promise<File> {
  assertValidImageFile(file);
  try {
    const thumb = await imageCompression(file, {
      maxWidthOrHeight: THUMB_MAX_DIMENSION,
      maxSizeMB: THUMB_MAX_SIZE_MB,
      initialQuality: THUMB_INITIAL_QUALITY,
      useWebWorker: true,
      fileType: file.type,
    });
    const named = withExtension(file.name, extensionForType(file.type));
    return new File([thumb], `thumb-${named}`, {
      type: file.type,
      lastModified: Date.now(),
    });
  } catch (error) {
    throw new ImageError(
      `Could not create a thumbnail for "${file.name}": ${
        error instanceof Error ? error.message : "compression failed"
      }`,
    );
  }
}

/**
 * Compress a file into BOTH a full-size image and a thumbnail in one call,
 * so a single picked file yields the two blobs the pipeline uploads.
 */
export async function prepareImage(
  file: File,
): Promise<{ full: File; thumb: File }> {
  assertValidImageFile(file);
  const [full, thumb] = await Promise.all([
    compressImage(file),
    makeThumbnail(file),
  ]);
  return { full, thumb };
}

/** `browser-image-compression` returns a Blob-ish File; re-wrap for a name. */
function normalizeCompressed(compressed: File, source: File): File {
  const named = withExtension(source.name, extensionForType(source.type));
  return new File([compressed], named, {
    type: source.type,
    lastModified: Date.now(),
  });
}

/** File extension for a supported MIME type. */
export function extensionForType(type: string): string {
  switch (type) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/avif":
      return "avif";
    default:
      return "jpg";
  }
}
