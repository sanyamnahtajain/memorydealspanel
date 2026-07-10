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

/** Full-size longest-edge cap, in pixels (matches design brief). */
const FULL_MAX_DIMENSION = 1600;
/** Full-size target byte budget after compression, in megabytes. */
const FULL_MAX_SIZE_MB = 0.5;
/** Thumbnail longest-edge cap, in pixels. */
const THUMB_MAX_DIMENSION = 400;
/** Thumbnail target byte budget after compression, in megabytes. */
const THUMB_MAX_SIZE_MB = 0.1;

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
 * Compress a full-size product image: longest edge <= 1600px, target <=
 * 0.5 MB. Preserves the source MIME type (JPEG/PNG/WebP/AVIF). Returns a new
 * `File` — the original is never mutated.
 */
export async function compressImage(file: File): Promise<File> {
  assertValidImageFile(file);
  try {
    const compressed = await imageCompression(file, {
      maxWidthOrHeight: FULL_MAX_DIMENSION,
      maxSizeMB: FULL_MAX_SIZE_MB,
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
 * Produce a small thumbnail (longest edge <= 400px) from the source file.
 * Used for the storefront grid / admin strip so we don't ship full-size
 * images into lists. Returns a new `File`.
 */
export async function makeThumbnail(file: File): Promise<File> {
  assertValidImageFile(file);
  try {
    const thumb = await imageCompression(file, {
      maxWidthOrHeight: THUMB_MAX_DIMENSION,
      maxSizeMB: THUMB_MAX_SIZE_MB,
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
