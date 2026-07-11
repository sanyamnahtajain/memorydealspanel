"use client";

/**
 * PhotoStrip — horizontal, drag-reorderable strip of a product's images.
 *
 * Each tile supports: set-as-primary (star), delete (via ConfirmSheet), and
 * drag-to-reorder (HTML5 DnD, pointer-friendly). All mutations call the
 * server actions optimistically and reconcile with the returned array; on
 * failure the previous order is restored and a toast is shown.
 *
 * `onAddFiles` is exposed on the component's props purely so a parent (e.g.
 * the camera capture button) can route captured photos through the SAME
 * upload pipeline — PhotoStrip forwards them to its `onAddFiles` prop; it does
 * not run the pipeline itself (ImageManager owns that).
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ImageOffIcon,
  Loader2Icon,
  StarIcon,
  Trash2Icon,
  GripVerticalIcon,
  Maximize2Icon,
  XIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import type { ProductImage } from "@prisma/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ConfirmSheet } from "@/components/common/ConfirmSheet";
import { toast } from "sonner";
import {
  removeImage,
  reorderImages,
  setPrimaryImage,
} from "@/server/actions/images";

export interface PhotoStripProps {
  productId: string;
  images: ProductImage[];
  /** Reconcile the parent's state after a mutation. */
  onImagesChange: (images: ProductImage[]) => void;
  /**
   * Route external files (e.g. camera captures) through the shared upload
   * pipeline. Wired by the parent (ImageManager); exposed so a camera button
   * can call `photoStripRef` handlers without duplicating upload logic.
   */
  onAddFiles?: (files: File[]) => void | Promise<void>;
  className?: string;
}

/** Prefer the small thumbnail; fall back to the full image. */
function tileSrc(image: ProductImage): string {
  return image.thumbUrl ?? image.url;
}

export function PhotoStrip({
  productId,
  images,
  onImagesChange,
  className,
}: PhotoStripProps) {
  const [busyUrl, setBusyUrl] = React.useState<string | null>(null);
  const [dragUrl, setDragUrl] = React.useState<string | null>(null);
  const [overUrl, setOverUrl] = React.useState<string | null>(null);
  // URL pending removal — drives a single controlled ConfirmSheet so each
  // tile's trigger stays a plain Tooltip-wrapped Button (Base UI merges the
  // dialog-trigger props onto a DOM button, not onto our Tooltip wrapper).
  const [pendingRemoveUrl, setPendingRemoveUrl] = React.useState<string | null>(
    null,
  );
  // Index of the image shown in the fullscreen lightbox, or null when closed.
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null);

  const handleSetPrimary = React.useCallback(
    async (url: string) => {
      if (busyUrl) return;
      setBusyUrl(url);
      const result = await setPrimaryImage(productId, url);
      setBusyUrl(null);
      if (result.ok) {
        onImagesChange(result.images);
        toast.success("Primary image updated.");
      } else {
        toast.error(result.error);
      }
    },
    [busyUrl, productId, onImagesChange],
  );

  const handleRemove = React.useCallback(
    async (url: string) => {
      const result = await removeImage(productId, url);
      if (result.ok) {
        onImagesChange(result.images);
        toast.success("Image removed.");
      } else {
        toast.error(result.error);
        throw new Error(result.error); // keep the ConfirmSheet open
      }
    },
    [productId, onImagesChange],
  );

  const commitOrder = React.useCallback(
    async (ordered: ProductImage[]) => {
      const previous = images;
      onImagesChange(ordered); // optimistic
      const result = await reorderImages(
        productId,
        ordered.map((img) => img.url),
      );
      if (result.ok) {
        onImagesChange(result.images);
      } else {
        onImagesChange(previous); // rollback
        toast.error(result.error);
      }
    },
    [images, productId, onImagesChange],
  );

  const handleDrop = React.useCallback(
    (targetUrl: string) => {
      setOverUrl(null);
      const sourceUrl = dragUrl;
      setDragUrl(null);
      if (!sourceUrl || sourceUrl === targetUrl) return;

      const from = images.findIndex((img) => img.url === sourceUrl);
      const to = images.findIndex((img) => img.url === targetUrl);
      if (from === -1 || to === -1) return;

      const reordered = images.slice();
      const [moved] = reordered.splice(from, 1);
      reordered.splice(to, 0, moved);
      void commitOrder(reordered);
    },
    [dragUrl, images, commitOrder],
  );

  if (images.length === 0) {
    return null;
  }

  return (
    <>
    <ul
      className={cn(
        "flex snap-x gap-3 overflow-x-auto pb-2",
        "[scrollbar-width:thin]",
        className,
      )}
      aria-label="Product images"
    >
      <AnimatePresence initial={false}>
        {images.map((image, index) => {
          const isBusy = busyUrl === image.url;
          const isDragging = dragUrl === image.url;
          const isOver = overUrl === image.url && dragUrl !== image.url;
          return (
            <motion.li
              key={image.url}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: isDragging ? 0.5 : 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
              draggable
              onDragStart={() => setDragUrl(image.url)}
              onDragEnd={() => {
                setDragUrl(null);
                setOverUrl(null);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setOverUrl(image.url);
              }}
              onDragLeave={() => setOverUrl((u) => (u === image.url ? null : u))}
              onDrop={(event) => {
                event.preventDefault();
                handleDrop(image.url);
              }}
              className={cn(
                "group/tile relative aspect-square h-28 w-28 shrink-0 snap-start",
                "overflow-hidden rounded-xl border border-border bg-muted",
                "ring-offset-2 ring-offset-background transition-shadow",
                isOver && "ring-2 ring-ring",
                image.isPrimary && "ring-2 ring-primary",
              )}
            >
              {/* Click the image (not the action buttons) to open the
                  fullscreen lightbox. A plain click opens it; dragging the tile
                  still reorders. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={tileSrc(image)}
                alt=""
                draggable={false}
                onClick={() => setLightboxIndex(index)}
                className="h-full w-full cursor-zoom-in object-cover"
                loading="lazy"
              />

              {/* Drag handle affordance */}
              <span
                aria-hidden
                className="absolute top-1 left-1 rounded-md bg-background/70 p-0.5 text-muted-foreground opacity-0 backdrop-blur-sm transition-opacity group-hover/tile:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <GripVerticalIcon className="size-3.5" />
              </span>

              {/* Primary badge */}
              {image.isPrimary ? (
                <span className="absolute top-1 right-1 flex items-center gap-1 rounded-md bg-primary px-1.5 py-0.5 text-[0.65rem] font-medium text-primary-foreground shadow-sm">
                  <StarIcon className="size-3 fill-current" />
                  Primary
                </span>
              ) : null}

              {/* Action overlay. On touch devices (no hover) it is ALWAYS
                  visible — otherwise Set-primary / Remove are unreachable. */}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-background/80 to-transparent p-1 opacity-0 transition-opacity group-hover/tile:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                <Tooltip content="View full size">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="secondary"
                    onClick={() => setLightboxIndex(index)}
                    aria-label="View image full size"
                  >
                    <Maximize2Icon />
                  </Button>
                </Tooltip>

                {!image.isPrimary ? (
                  <Tooltip content="Set as primary">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="secondary"
                      disabled={isBusy}
                      onClick={() => handleSetPrimary(image.url)}
                      aria-label="Set as primary image"
                    >
                      {isBusy ? (
                        <Loader2Icon className="animate-spin" />
                      ) : (
                        <StarIcon />
                      )}
                    </Button>
                  </Tooltip>
                ) : null}

                <Tooltip content="Remove image">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="destructive"
                    aria-label="Remove image"
                    onClick={() => setPendingRemoveUrl(image.url)}
                  >
                    <Trash2Icon />
                  </Button>
                </Tooltip>
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>

      <ConfirmSheet
        title="Remove this image?"
        description="It will be detached from the product. This cannot be undone."
        destructive
        confirmLabel="Remove"
        open={pendingRemoveUrl !== null}
        onOpenChange={(next) => {
          if (!next) setPendingRemoveUrl(null);
        }}
        onConfirm={async () => {
          if (pendingRemoveUrl === null) return;
          await handleRemove(pendingRemoveUrl);
          setPendingRemoveUrl(null);
        }}
      />

      {lightboxIndex !== null ? (
        <Lightbox
          images={images}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      ) : null}
    </>
  );
}

/**
 * Fullscreen image preview. Renders through a portal so it always covers the
 * viewport regardless of any transformed ancestor. Esc closes; ← / → navigate;
 * clicking the backdrop closes. Shows the FULL image (`url`), not the thumbnail.
 */
function Lightbox({
  images,
  index,
  onClose,
  onNavigate,
}: {
  images: ProductImage[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const count = images.length;
  const image = images[index];

  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") onNavigate((index + 1) % count);
      else if (event.key === "ArrowLeft") onNavigate((index - 1 + count) % count);
    }
    window.addEventListener("keydown", onKey);
    // Lock body scroll while open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [index, count, onClose, onNavigate]);

  if (!image) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      onClick={onClose}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        className="absolute top-3 right-3 inline-flex size-10 items-center justify-center rounded-full bg-white/10 text-white outline-none transition-colors hover:bg-white/20 focus-visible:ring-3 focus-visible:ring-white/40"
      >
        <XIcon className="size-5" />
      </button>

      {count > 1 ? (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate((index - 1 + count) % count);
            }}
            aria-label="Previous image"
            className="absolute left-3 inline-flex size-11 items-center justify-center rounded-full bg-white/10 text-white outline-none transition-colors hover:bg-white/20 focus-visible:ring-3 focus-visible:ring-white/40"
          >
            <ChevronLeftIcon className="size-6" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate((index + 1) % count);
            }}
            aria-label="Next image"
            className="absolute right-3 inline-flex size-11 items-center justify-center rounded-full bg-white/10 text-white outline-none transition-colors hover:bg-white/20 focus-visible:ring-3 focus-visible:ring-white/40"
          >
            <ChevronRightIcon className="size-6" />
          </button>
        </>
      ) : null}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-h-[86vh] max-w-full rounded-lg object-contain shadow-2xl"
      />

      {count > 1 ? (
        <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-sm font-medium text-white tabular-nums">
          {index + 1} / {count}
        </span>
      ) : null}
    </div>,
    document.body,
  );
}

/** Empty-strip placeholder, exported for the manager to reuse. */
export function PhotoStripEmpty({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-28 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground",
        className,
      )}
    >
      <ImageOffIcon className="mr-2 size-4" />
      <span className="text-sm">No images yet</span>
    </div>
  );
}
