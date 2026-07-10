"use client";

/**
 * useImageUploads — the single client-side upload pipeline for product images.
 *
 * One place owns the full per-file flow so that BOTH the drag/drop + file
 * picker (ImageManager) and captured camera photos (fed via PhotoStrip's
 * `onAddFiles`) go through exactly the same steps:
 *
 *   1. validate + enforce the per-product cap (lib/image)
 *   2. compress -> full image + thumbnail (lib/image, in a Web Worker)
 *   3. presignUpload() to get an upload target (R2 presigned OR local route)
 *   4. PUT/POST the full image, then the thumbnail, to the target
 *   5. attachImageToProduct() to persist the embedded ProductImage
 *
 * Progress for each in-flight file is exposed so the UI can render a strip of
 * upload cards. Completed/failed entries are surfaced too (failed ones stay
 * until dismissed); on success the caller is handed the fresh image array.
 */

import * as React from "react";
import { toast } from "sonner";
import type { ProductImage } from "@prisma/client";
import {
  assertValidImageFile,
  assertWithinImageCap,
  ImageError,
  MAX_IMAGES_PER_PRODUCT,
  prepareImage,
} from "@/lib/image";
import {
  attachImageToProduct,
  presignUpload,
} from "@/server/actions/images";

/** Coarse lifecycle phase for an in-flight upload. */
export type UploadPhase =
  | "compressing"
  | "uploading"
  | "saving"
  | "done"
  | "error";

export interface UploadItem {
  /** Stable client id for this upload attempt. */
  id: string;
  fileName: string;
  /** Object URL for an instant local preview (revoked on removal). */
  previewUrl: string;
  phase: UploadPhase;
  /** 0–100 for the active phase (upload bytes when known). */
  progress: number;
  error?: string;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `upl_${Date.now().toString(36)}_${counter}`;
}

/** Upload a single blob to the target, resolving on completion. */
function putBlob(
  target: { mode: string; uploadUrl: string; headers: Record<string, string> },
  blob: Blob,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    // Presigned R2 wants a direct PUT; the local dev route accepts PUT too.
    xhr.open("PUT", target.uploadUrl, true);
    for (const [key, value] of Object.entries(target.headers)) {
      xhr.setRequestHeader(key, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.loaded / event.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(blob);
  });
}

export interface UseImageUploadsOptions {
  productId: string;
  /** Current stored image count — gates the per-product cap. */
  currentCount: number;
  /** Called with the fresh image array after each successful attach. */
  onImagesChange: (images: ProductImage[]) => void;
}

export interface UseImageUploads {
  uploads: UploadItem[];
  isUploading: boolean;
  /** Feed files from the picker, drag/drop, OR the camera capture. */
  addFiles: (files: File[]) => Promise<void>;
  /** Dismiss a finished (done/error) upload card. */
  dismiss: (id: string) => void;
}

export function useImageUploads({
  productId,
  currentCount,
  onImagesChange,
}: UseImageUploadsOptions): UseImageUploads {
  const [uploads, setUploads] = React.useState<UploadItem[]>([]);

  // Live count = stored images + uploads not yet failed, so a batch can't
  // blow past the cap even before the server round-trips complete.
  const countRef = React.useRef(currentCount);
  React.useEffect(() => {
    countRef.current = currentCount;
  }, [currentCount]);

  const patch = React.useCallback(
    (id: string, next: Partial<UploadItem>) => {
      setUploads((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...next } : item)),
      );
    },
    [],
  );

  const dismiss = React.useCallback((id: string) => {
    setUploads((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const runOne = React.useCallback(
    async (file: File, item: UploadItem) => {
      try {
        patch(item.id, { phase: "compressing", progress: 0 });
        const { full, thumb } = await prepareImage(file);

        patch(item.id, { phase: "uploading", progress: 0 });
        const fullTarget = await presignUpload(productId, full.name, full.type);
        if (!fullTarget.ok) {
          throw new ImageError(fullTarget.error);
        }
        await putBlob(fullTarget, full, (fraction) =>
          patch(item.id, { progress: Math.round(fraction * 90) }),
        );

        // Thumbnail is best-effort: if it fails, we still attach the full image.
        let thumbUrl: string | undefined;
        try {
          const thumbTarget = await presignUpload(
            productId,
            thumb.name,
            thumb.type,
          );
          if (thumbTarget.ok) {
            await putBlob(thumbTarget, thumb);
            thumbUrl = thumbTarget.publicUrl;
          }
        } catch {
          thumbUrl = undefined;
        }

        patch(item.id, { phase: "saving", progress: 95 });
        const attached = await attachImageToProduct(productId, {
          url: fullTarget.publicUrl,
          thumbUrl,
        });
        if (!attached.ok) {
          throw new ImageError(attached.error);
        }

        onImagesChange(attached.images);
        patch(item.id, { phase: "done", progress: 100 });
        // Auto-dismiss the success card after a beat.
        window.setTimeout(() => dismiss(item.id), 1200);
      } catch (error) {
        countRef.current = Math.max(0, countRef.current - 1);
        const message =
          error instanceof ImageError || error instanceof Error
            ? error.message
            : "Upload failed";
        patch(item.id, { phase: "error", progress: 0, error: message });
        toast.error(message);
      }
    },
    [productId, patch, dismiss, onImagesChange],
  );

  const addFiles = React.useCallback(
    async (incoming: File[]) => {
      if (incoming.length === 0) return;

      // Validate the whole batch against the cap up front.
      const accepted: File[] = [];
      for (const file of incoming) {
        try {
          assertValidImageFile(file);
          assertWithinImageCap(countRef.current + accepted.length, 1);
          accepted.push(file);
        } catch (error) {
          const message =
            error instanceof ImageError
              ? error.message
              : `"${file.name}" could not be added.`;
          toast.error(message);
        }
      }
      if (accepted.length === 0) return;

      countRef.current += accepted.length;
      const items: UploadItem[] = accepted.map((file) => ({
        id: nextId(),
        fileName: file.name,
        previewUrl: URL.createObjectURL(file),
        phase: "compressing" as const,
        progress: 0,
      }));
      setUploads((prev) => [...prev, ...items]);

      // Process sequentially to keep the worker + network calm on mobile.
      for (let i = 0; i < accepted.length; i += 1) {
        await runOne(accepted[i], items[i]);
      }
    },
    [runOne],
  );

  // Revoke any leftover object URLs on unmount.
  React.useEffect(() => {
    return () => {
      setUploads((prev) => {
        for (const item of prev) URL.revokeObjectURL(item.previewUrl);
        return prev;
      });
    };
  }, []);

  const isUploading = uploads.some(
    (item) => item.phase !== "done" && item.phase !== "error",
  );

  return { uploads, isUploading, addFiles, dismiss };
}

export { MAX_IMAGES_PER_PRODUCT };
