"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2, Play, Trash2, Upload } from "lucide-react";
import type { ProductVideo } from "@prisma/client";

import { Button } from "@/components/ui/button";
import {
  MAX_VIDEOS_PER_PRODUCT,
  MAX_VIDEO_MB,
  VIDEO_ACCEPT_ATTR,
  rejectVideo,
} from "@/lib/video";
import {
  attachProductVideo,
  presignVideoUpload,
  removeProductVideo,
} from "@/server/actions/product-videos";

/**
 * Product demo videos in the editor.
 *
 * Like the photo field, uploads persist IMMEDIATELY (they need a real
 * productId to presign against), so this only renders in edit mode — the
 * editor shows a "save first" hint on a new product.
 *
 * The file goes BROWSER → R2 directly via a presigned PUT; the bytes never
 * touch a serverless function, so a 30MB clip has no request-size or
 * function-duration problem. There is no client-side transcode — see
 * src/lib/video.ts for why the ceilings are what they are.
 */
export function ProductVideosField({
  productId,
  initialVideos,
  disabled,
}: {
  productId: string;
  initialVideos: ProductVideo[];
  disabled?: boolean;
}) {
  const [videos, setVideos] = React.useState<ProductVideo[]>(initialVideos);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const atLimit = videos.length >= MAX_VIDEOS_PER_PRODUCT;

  async function handleFile(file: File) {
    // Same rules the server enforces — checked here purely so the operator
    // gets a useful message instead of a rejected upload.
    const rejection = rejectVideo(file, videos.length);
    if (rejection) {
      toast.error(rejection.message);
      return;
    }

    setBusy(true);
    setProgress("Preparing…");
    try {
      const target = await presignVideoUpload(productId, file.name, file.type);
      if (!target.ok) {
        toast.error(target.error);
        return;
      }

      setProgress("Uploading…");
      const put = await fetch(target.uploadUrl, {
        method: "PUT",
        headers: target.headers,
        body: file,
      });
      if (!put.ok) {
        toast.error("The upload failed. Please check your connection and retry.");
        return;
      }

      setProgress("Saving…");
      const attached = await attachProductVideo(productId, target.publicUrl);
      if (!attached.ok) {
        toast.error(attached.error);
        return;
      }
      setVideos(attached.videos);
      toast.success("Video added.");
    } catch (error) {
      console.error("[product-videos] upload failed:", error);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove(url: string) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await removeProductVideo(productId, url);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setVideos(result.videos);
      toast.success("Video removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={VIDEO_ACCEPT_ATTR}
          className="sr-only"
          disabled={disabled || busy || atLimit}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled || busy || atLimit}
          aria-busy={busy || undefined}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {progress ?? "Working…"}
            </>
          ) : (
            <>
              <Upload className="size-4" aria-hidden />
              Add video
            </>
          )}
        </Button>
        <span className="text-xs text-muted-foreground">
          {atLimit
            ? `Maximum ${MAX_VIDEOS_PER_PRODUCT} videos.`
            : `MP4, WebM or MOV · up to ${MAX_VIDEO_MB}MB · ${videos.length}/${MAX_VIDEOS_PER_PRODUCT} used`}
        </span>
      </div>

      {videos.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          A short clip — ten seconds of the product turning in the hand — sells
          better than a long one, and costs the buyer far less mobile data.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {videos.map((video) => (
            <li
              key={video.url}
              className="relative w-40 overflow-hidden rounded-xl border border-border bg-muted/30"
            >
              <video
                src={video.url}
                poster={video.posterUrl ?? undefined}
                controls
                playsInline
                preload="metadata"
                className="aspect-square w-full bg-black object-contain"
              />
              <button
                type="button"
                onClick={() => void handleRemove(video.url)}
                disabled={disabled || busy}
                aria-label="Remove video"
                className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-background/90 text-destructive shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Small badge used by the editor's section header. */
export function VideoCountBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      <Play className="size-2.5 fill-current" aria-hidden />
      {count}
    </span>
  );
}
