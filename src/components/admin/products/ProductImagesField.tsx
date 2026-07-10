"use client";

/**
 * ProductImagesField — the integration seam between the product editor and the
 * image pipeline.
 *
 * It mounts the {@link ImageManager} (drag/drop + file picker + upload cards +
 * the reorderable {@link PhotoStrip}) and a {@link CameraTrigger}. Every entry
 * point — desktop drop, file picker, or the mobile batch camera — funnels the
 * captured `File[]` through the SAME `ImageManager.addFiles` handle, so all
 * uploads run the one shared compress -> presign -> attach pipeline.
 *
 * `CameraTrigger` itself picks the right surface per device: on a mobile
 * device with a usable camera it opens the full-screen batch capture overlay;
 * on desktop (or without camera/secure-context) it degrades to a multi-file
 * picker. This component just routes its output into the manager.
 *
 * Because the pipeline persists each image to the server immediately (it needs
 * a real `productId` to presign + attach), photos can only be managed once the
 * product exists. The editor therefore only renders this field in edit mode;
 * in create mode it shows a hint telling the operator to save first. The field
 * keeps the parent form's `images` in sync via `onImagesChange` so the editor
 * stays the single source of truth for its payload.
 */

import * as React from "react";
import type { ProductImage } from "@prisma/client";
import type { ProductImageInput } from "@/lib/schemas/product";
import { MAX_IMAGES_PER_PRODUCT } from "@/lib/image";
import {
  ImageManager,
  type ImageManagerHandle,
} from "@/components/admin/images";
import { CameraTrigger } from "@/components/admin/camera";

export interface ProductImagesFieldProps {
  /** Persisted product id — required to presign + attach uploads. */
  productId: string;
  /** Current images from the editor form (the single source of truth). */
  images: ProductImageInput[];
  /** Push the freshly-persisted image set back up into the editor form. */
  onImagesChange: (images: ProductImageInput[]) => void;
  /** Suspend interaction while the form is submitting. */
  disabled?: boolean;
}

/** Normalize a stored `ProductImage` to the form's `ProductImageInput`. */
function toInput(image: ProductImage): ProductImageInput {
  return {
    url: image.url,
    thumbUrl: image.thumbUrl ?? undefined,
    sortOrder: image.sortOrder,
    isPrimary: image.isPrimary,
  };
}

/** Rehydrate the form's `ProductImageInput` back into a `ProductImage`. */
function toStored(image: ProductImageInput, index: number): ProductImage {
  return {
    url: image.url,
    thumbUrl: image.thumbUrl ?? null,
    sortOrder: image.sortOrder ?? index,
    isPrimary: image.isPrimary ?? false,
  };
}

export function ProductImagesField({
  productId,
  images,
  onImagesChange,
  disabled = false,
}: ProductImagesFieldProps) {
  const managerRef = React.useRef<ImageManagerHandle>(null);

  // Seed the manager once; thereafter it owns the live set and reports every
  // change back up. We map its `ProductImage[]` to the form's input shape.
  const initialImages = React.useMemo(
    () => images.map(toStored),
    // Seed only on mount — subsequent updates flow through onImagesChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleManagerChange = React.useCallback(
    (next: ProductImage[]) => {
      onImagesChange(next.map(toInput));
    },
    [onImagesChange],
  );

  const capReached = images.length >= MAX_IMAGES_PER_PRODUCT;

  const handleCameraFiles = React.useCallback((files: File[]) => {
    void managerRef.current?.addFiles(files);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {images.length}/{MAX_IMAGES_PER_PRODUCT} photos · the first is the
          primary.
        </p>
        <CameraTrigger
          onFiles={handleCameraFiles}
          disabled={disabled || capReached}
          size="sm"
        />
      </div>

      <ImageManager
        ref={managerRef}
        productId={productId}
        initialImages={initialImages}
        onImagesChange={handleManagerChange}
      />
    </div>
  );
}
