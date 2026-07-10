"use client";

/**
 * ImageManager — the product photo editor surface.
 *
 * Composes the whole client pipeline:
 *   - a drag/drop + file-picker drop zone (validates + feeds the pipeline)
 *   - per-file upload cards with live progress (compress -> upload -> save)
 *   - the PhotoStrip of already-stored images (reorder / primary / delete)
 *
 * It owns the shared `useImageUploads` pipeline and exposes an imperative
 * `onAddFiles` handle (via ref) so a camera-capture component can push
 * captured photos through the exact same flow.
 */

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ImagePlusIcon,
  Loader2Icon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react";
import type { ProductImage } from "@prisma/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FadeUp } from "@/components/motion/primitives";
import { IMAGE_ACCEPT_ATTR, MAX_IMAGES_PER_PRODUCT } from "@/lib/image";
import { PhotoStrip, PhotoStripEmpty } from "./PhotoStrip";
import {
  useImageUploads,
  type UploadItem,
  type UploadPhase,
} from "./use-image-uploads";

/** Imperative handle so a camera button can feed captured files in. */
export interface ImageManagerHandle {
  addFiles: (files: File[]) => void | Promise<void>;
}

export interface ImageManagerProps {
  productId: string;
  /** Initial stored images (from the product editor's server data). */
  initialImages: ProductImage[];
  /** Notified whenever the stored image set changes (attach/reorder/remove). */
  onImagesChange?: (images: ProductImage[]) => void;
  className?: string;
}

const PHASE_LABEL: Record<UploadPhase, string> = {
  compressing: "Optimising…",
  uploading: "Uploading…",
  saving: "Saving…",
  done: "Done",
  error: "Failed",
};

export const ImageManager = React.forwardRef<
  ImageManagerHandle,
  ImageManagerProps
>(function ImageManager(
  { productId, initialImages, onImagesChange, className },
  ref,
) {
  const [images, setImages] = React.useState<ProductImage[]>(initialImages);
  const [isDragActive, setDragActive] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const dragDepth = React.useRef(0);

  const handleImagesChange = React.useCallback(
    (next: ProductImage[]) => {
      setImages(next);
      onImagesChange?.(next);
    },
    [onImagesChange],
  );

  const { uploads, isUploading, addFiles, dismiss } = useImageUploads({
    productId,
    currentCount: images.length,
    onImagesChange: handleImagesChange,
  });

  React.useImperativeHandle(ref, () => ({ addFiles }), [addFiles]);

  const remaining = Math.max(0, MAX_IMAGES_PER_PRODUCT - images.length);
  const capReached = remaining === 0;

  const openPicker = React.useCallback(() => {
    if (!capReached) inputRef.current?.click();
  }, [capReached]);

  const onPicked = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files ? Array.from(event.target.files) : [];
      event.target.value = ""; // allow re-picking the same file
      if (files.length) void addFiles(files);
    },
    [addFiles],
  );

  const onDrop = React.useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragActive(false);
      if (capReached) return;
      const files = event.dataTransfer?.files
        ? Array.from(event.dataTransfer.files)
        : [];
      if (files.length) void addFiles(files);
    },
    [addFiles, capReached],
  );

  const onDragEnter = React.useCallback((event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  }, []);

  const onDragLeave = React.useCallback((event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragActive(false);
    }
  }, []);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Drop zone / picker */}
      <div
        role="button"
        tabIndex={0}
        aria-disabled={capReached}
        aria-label="Add product images"
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPicker();
          }
        }}
        onDragEnter={onDragEnter}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors",
          "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          capReached
            ? "cursor-not-allowed border-border bg-muted/40 text-muted-foreground"
            : "cursor-pointer border-border hover:border-ring hover:bg-accent/40",
          isDragActive && !capReached && "border-ring bg-accent/60",
        )}
      >
        <span
          className={cn(
            "flex size-11 items-center justify-center rounded-full",
            capReached
              ? "bg-muted text-muted-foreground"
              : "bg-primary/10 text-primary",
          )}
        >
          <UploadCloudIcon className="size-5" />
        </span>
        {capReached ? (
          <p className="text-sm font-medium">
            Maximum of {MAX_IMAGES_PER_PRODUCT} images reached
          </p>
        ) : (
          <>
            <p className="text-sm font-medium">
              Drag &amp; drop images, or{" "}
              <span className="text-primary underline underline-offset-2">
                browse
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              JPEG, PNG, WebP or AVIF · up to 5 MB each · {remaining} slot
              {remaining === 1 ? "" : "s"} left
            </p>
          </>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_ACCEPT_ATTR}
          multiple
          className="sr-only"
          onChange={onPicked}
          tabIndex={-1}
        />
      </div>

      {/* In-flight upload cards */}
      <AnimatePresence>
        {uploads.length > 0 ? (
          <motion.ul
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="grid grid-cols-2 gap-2 overflow-hidden sm:grid-cols-3"
          >
            {uploads.map((item) => (
              <UploadCard key={item.id} item={item} onDismiss={dismiss} />
            ))}
          </motion.ul>
        ) : null}
      </AnimatePresence>

      {/* Stored images */}
      {images.length > 0 ? (
        <FadeUp>
          <PhotoStrip
            productId={productId}
            images={images}
            onImagesChange={handleImagesChange}
            onAddFiles={addFiles}
          />
        </FadeUp>
      ) : uploads.length === 0 ? (
        <PhotoStripEmpty />
      ) : null}

      {/* Secondary add button (useful on mobile / when the zone is scrolled off) */}
      {!capReached ? (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openPicker}
            disabled={isUploading && uploads.length >= remaining}
          >
            {isUploading ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <ImagePlusIcon />
            )}
            Add images
          </Button>
          <span className="text-xs text-muted-foreground">
            {images.length}/{MAX_IMAGES_PER_PRODUCT}
          </span>
        </div>
      ) : null}
    </div>
  );
});

/** A single in-flight (or just-finished) upload with progress. */
function UploadCard({
  item,
  onDismiss,
}: {
  item: UploadItem;
  onDismiss: (id: string) => void;
}) {
  const isError = item.phase === "error";
  return (
    <motion.li
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card",
        isError ? "border-destructive/50" : "border-border",
      )}
    >
      <div className="flex items-center gap-3 p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.previewUrl}
          alt=""
          className="size-12 shrink-0 rounded-lg object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium" title={item.fileName}>
            {item.fileName}
          </p>
          <p
            className={cn(
              "text-[0.7rem]",
              isError ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {isError ? item.error : PHASE_LABEL[item.phase]}
          </p>
          {!isError ? (
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={false}
                animate={{ width: `${item.progress}%` }}
                transition={{ ease: "easeOut", duration: 0.2 }}
              />
            </div>
          ) : null}
        </div>
        {item.phase === "done" || isError ? (
          <button
            type="button"
            onClick={() => onDismiss(item.id)}
            aria-label="Dismiss"
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        ) : (
          <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />
        )}
      </div>
    </motion.li>
  );
}
