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
 * SIZE AND QUALITY BUDGETS — store the BEST copy, serve small ones.
 *
 * Owner rule (Nov 2026): uploads must be kept at the highest quality.
 *
 * Every picture the shop shows goes through the resizer (/api/img, see
 * src/lib/image-loader.ts), which cuts the size each screen needs from the
 * stored original and caches it. So the original no longer has to be small to
 * keep pages fast — it has to be GOOD, because it is the source of every copy
 * and of the product gallery's zoom. Anything compressed here is permanently
 * soft; there is no second chance later.
 *
 *  - A photo already within the limits is uploaded EXACTLY as taken — no
 *    re-encode at all (see `withinBudget`).
 *  - Larger ones are scaled to a generous edge and re-encoded starting at a
 *    very high quality, stepping down only if the byte budget demands it.
 *  - The 15 MB per-file cap (MAX_IMAGE_SIZE_BYTES) still guards uploads.
 */

/** Full-size longest-edge cap, in pixels — sharp zoom on any phone or laptop. */
const FULL_MAX_DIMENSION = 3000;
/** Full-size byte budget after compression, in megabytes. */
const FULL_MAX_SIZE_MB = 4;
/** Encoder quality to start from before the size budget forces it down. */
const FULL_INITIAL_QUALITY = 0.95;
/** Thumbnail longest-edge cap, in pixels. */
const THUMB_MAX_DIMENSION = 1000;
/** Thumbnail byte budget after compression, in megabytes. */
const THUMB_MAX_SIZE_MB = 0.35;
/** Thumbnails are never zoomed, but are what grids start from. */
const THUMB_INITIAL_QUALITY = 0.9;

/*
 * Banner artwork: wide, never zoomed, and the home page's first image. The
 * resizer serves phones a small copy, so the stored original can be the
 * owner's full-quality artwork too.
 */
const BANNER_MAX_DIMENSION = 2400;
const BANNER_MAX_SIZE_MB = 2.5;
const BANNER_INITIAL_QUALITY = 0.93;

/**
 * Already small enough to keep exactly as it is? Then it is uploaded
 * untouched — re-encoding a good photo only ever loses detail.
 */
async function withinBudget(file: File, maxDimension: number, maxSizeMB: number): Promise<boolean> {
  if (file.size > maxSizeMB * 1024 * 1024) return false;
  if (typeof createImageBitmap !== "function") return false;
  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    bitmap.close?.();
    return longest <= maxDimension;
  } catch {
    return false;
  }
}

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
 * Prepare a full-size product image at the highest sensible quality: kept
 * untouched when already within budget, otherwise longest edge <=
 * FULL_MAX_DIMENSION and <= FULL_MAX_SIZE_MB, starting at quality 0.95. Preserves the source MIME type
 * (JPEG/PNG/WebP/AVIF). Returns a new `File` — the original is never mutated.
 */
export async function compressImage(file: File): Promise<File> {
  assertValidImageFile(file);
  if (await withinBudget(file, FULL_MAX_DIMENSION, FULL_MAX_SIZE_MB)) return file;
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
 * Prepare banner artwork: the owner's file as-is when within budget, else a
 * high-quality scale-down. Phones get a small copy from the resizer.
 */
export async function compressBannerArtwork(file: File): Promise<File> {
  assertValidImageFile(file);
  if (await withinBudget(file, BANNER_MAX_DIMENSION, BANNER_MAX_SIZE_MB)) return file;
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

export { SMALL_PHOTO_EDGE, isSmallPhoto } from "@/lib/photo-quality";

/**
 * Pixel size of a photo about to be uploaded, or null when the browser can't
 * tell. Recorded with the image so the admin can flag photos too small to
 * look sharp (see SMALL_PHOTO_EDGE).
 */
export async function measureImage(file: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}
