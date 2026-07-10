"use client";

/**
 * ImageCell — a thumbnail strip of a row's images.
 *
 * The stored value is a list of image URLs/asset refs (string | string[]).
 * Renderer: a compact horizontal strip of thumbnails with a "+N" overflow
 * badge; clicking anywhere on the strip fires the injected
 * `actions.onOpenImages(row.id)` so the engine can open its gallery/manager.
 * Editor: the same strip presented as a button — Enter/Space/click opens the
 * image manager (there is no inline text editing of images), Esc cancels.
 *
 * Image assets are managed elsewhere; this cell never mutates the value, so its
 * Editor commits nothing on its own — it delegates to `onOpenImages`.
 */

import * as React from "react";
import { ImageIcon, ImagesIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CellEditorProps, CellRendererProps } from "./cell-props";

/** Max thumbnails shown before collapsing into a "+N" badge. */
const MAX_THUMBS = 4;

/** Coerce a stored value into an array of image sources. */
export function toImageList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string" && value !== "") return [value];
  return [];
}

interface StripProps {
  images: string[];
  className?: string;
}

/** The visual thumbnail strip (no interactivity of its own). */
function ThumbStrip({ images, className }: StripProps) {
  if (images.length === 0) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-sm text-muted-foreground",
          className,
        )}
      >
        <ImageIcon className="size-4" />
        <span>No images</span>
      </span>
    );
  }
  const shown = images.slice(0, MAX_THUMBS);
  const overflow = images.length - shown.length;
  return (
    <span className={cn("flex items-center gap-1", className)}>
      {shown.map((src, i) => (
        <span
          key={`${src}-${i}`}
          className="relative size-7 shrink-0 overflow-hidden rounded-md border border-border bg-muted"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            loading="lazy"
            className="size-full object-cover"
            draggable={false}
          />
        </span>
      ))}
      {overflow > 0 ? (
        <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-muted text-xs font-medium text-muted-foreground">
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}

export function ImageRenderer({ value, row, actions, className }: CellRendererProps) {
  const images = toImageList(value);
  const open = actions?.onOpenImages;
  return (
    <button
      type="button"
      data-slot="image-cell"
      disabled={!open}
      onClick={() => open?.(row.id)}
      title={open ? "Manage images" : undefined}
      className={cn(
        "flex h-full w-full items-center gap-1 rounded px-1 text-left",
        open ? "cursor-pointer hover:bg-accent/50" : "cursor-default",
        className,
      )}
    >
      <ThumbStrip images={images} />
    </button>
  );
}

export function ImageEditor({
  value,
  row,
  actions,
  onCancel,
  className,
}: CellEditorProps) {
  const images = toImageList(value);
  const open = actions?.onOpenImages;
  const btnRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    btnRef.current?.focus();
    // Open the manager immediately when entering edit mode — images have no
    // inline editor, so "editing" this cell means "manage its gallery".
    open?.(row.id);
  }, [open, row.id]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      open?.(row.id);
    }
  };

  return (
    <button
      ref={btnRef}
      type="button"
      data-slot="image-cell-editor"
      onClick={() => open?.(row.id)}
      onKeyDown={onKeyDown}
      className={cn(
        "flex h-full w-full items-center gap-1.5 rounded bg-background px-2 text-left ring-2 ring-inset ring-ring outline-none",
        className,
      )}
    >
      <ImagesIcon className="size-4 shrink-0 text-muted-foreground" />
      <ThumbStrip images={images} />
    </button>
  );
}
