"use client";

import * as React from "react";
import { toast } from "sonner";
import { Clapperboard, Image as ImageIcon, Loader2, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ImageError, compressBannerArtwork } from "@/lib/image";
import { MAX_REEL_CAPTION, instagramUrlSchema } from "@/lib/reels";
import {
  MAX_VIDEO_BYTES,
  MAX_VIDEO_MB,
  VIDEO_ACCEPT_ATTR,
  isAcceptedVideoType,
} from "@/lib/video";
import {
  presignReelPosterUpload,
  presignReelUpload,
  saveReelAction,
} from "@/server/actions/reels";
import type { AdminReel } from "@/server/services/reels";
import { ReelProductPicker, type PickedProduct } from "./ReelProductPicker";
import { formatDuration, probeVideoDuration, putWithProgress } from "./upload";

/**
 * Create / edit one reel. The clip goes straight from the browser to storage
 * (presigned PUT) with a progress bar; the row is only written once the
 * upload has landed, so a reel can never point at a missing file.
 */

const ACCEPTED_POSTER_TYPES = ["image/jpeg", "image/png", "image/webp"];

type UploadState =
  | { phase: "idle" }
  | { phase: "probing" }
  | { phase: "uploading"; fraction: number }
  | { phase: "error"; message: string };

export function ReelDialog({
  reel,
  nextSortOrder,
  onClose,
  onSaved,
}: {
  reel: AdminReel | null;
  /** Where a NEW reel lands in the order — the end of the list. */
  nextSortOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [videoUrl, setVideoUrl] = React.useState(reel?.videoUrl ?? "");
  const [posterUrl, setPosterUrl] = React.useState(reel?.posterUrl ?? "");
  const [caption, setCaption] = React.useState(reel?.caption ?? "");
  const [instagramUrl, setInstagramUrl] = React.useState(
    reel?.instagramUrl ?? "",
  );
  const [durationSec, setDurationSec] = React.useState<number | null>(
    reel?.durationSec ?? null,
  );
  const [product, setProduct] = React.useState<PickedProduct | null>(
    reel?.product
      ? {
          id: reel.product.id,
          name: reel.product.name,
          imageUrl: reel.product.imageUrl,
        }
      : reel?.productId
        ? // Linked product is hidden/deleted: show the link so it can be cleared.
          { id: reel.productId, name: "Hidden product", imageUrl: null }
        : null,
  );
  const [sortOrder, setSortOrder] = React.useState(
    String(reel?.sortOrder ?? nextSortOrder),
  );
  const [active, setActive] = React.useState(reel?.active ?? true);
  const [saving, setSaving] = React.useState(false);
  const [video, setVideo] = React.useState<UploadState>({ phase: "idle" });
  const [posterBusy, setPosterBusy] = React.useState(false);

  const videoInputRef = React.useRef<HTMLInputElement>(null);
  const posterInputRef = React.useRef<HTMLInputElement>(null);

  const busy =
    saving || posterBusy || video.phase === "uploading" || video.phase === "probing";

  const instagramInvalid =
    instagramUrl.trim() !== "" &&
    !instagramUrlSchema.safeParse(instagramUrl).success;

  async function uploadVideo(file: File) {
    // Both ceilings are the product-video ones (src/lib/video.ts). Checked
    // here for a useful message; the server validates the size again and
    // signs it into the upload, so storage enforces the real limit.
    if (!isAcceptedVideoType(file.type)) {
      setVideo({
        phase: "error",
        message: `"${file.name}" is not a supported video. Use MP4, WebM or MOV.`,
      });
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      const mb = Math.ceil(file.size / (1024 * 1024));
      setVideo({
        phase: "error",
        message: `"${file.name}" is ${mb}MB — the limit is ${MAX_VIDEO_MB}MB. Trim the clip and try again.`,
      });
      return;
    }

    try {
      setVideo({ phase: "probing" });
      const probed = await probeVideoDuration(file);
      if (probed !== null) setDurationSec(probed);

      setVideo({ phase: "uploading", fraction: 0 });
      const target = await presignReelUpload(file.name, file.type, file.size);
      if (!target.ok) {
        setVideo({ phase: "error", message: target.error });
        return;
      }
      await putWithProgress(target, file, (fraction) =>
        setVideo({ phase: "uploading", fraction }),
      );
      setVideoUrl(target.publicUrl);
      setVideo({ phase: "idle" });
    } catch (error) {
      setVideo({
        phase: "error",
        message:
          error instanceof Error && error.message
            ? `${error.message}. Please try again.`
            : "The upload failed. Please try again.",
      });
    }
  }

  async function uploadPoster(file: File) {
    if (!ACCEPTED_POSTER_TYPES.includes(file.type)) {
      toast.error("The poster must be a JPG, PNG or WebP.");
      return;
    }
    setPosterBusy(true);
    try {
      let artwork: File;
      try {
        artwork = await compressBannerArtwork(file);
      } catch (error) {
        toast.error(
          error instanceof ImageError
            ? error.message
            : "That image could not be processed. Try a JPG, PNG or WebP.",
        );
        return;
      }
      const target = await presignReelPosterUpload(artwork.name, artwork.type);
      if (!target.ok) {
        toast.error(target.error);
        return;
      }
      await putWithProgress(target, artwork);
      setPosterUrl(target.publicUrl);
    } catch {
      toast.error("The poster upload failed. Please try again.");
    } finally {
      setPosterBusy(false);
    }
  }

  async function save() {
    if (busy) return;
    if (videoUrl.trim() === "") {
      toast.error("Upload the clip first.");
      return;
    }
    if (caption.trim() === "") {
      toast.error("Write a short caption.");
      return;
    }
    if (instagramInvalid) {
      toast.error("The Instagram link must be a full https://instagram.com/… address.");
      return;
    }
    const order = Number.parseInt(sortOrder, 10);
    setSaving(true);
    try {
      const res = await saveReelAction(
        {
          videoUrl: videoUrl.trim(),
          posterUrl: posterUrl.trim() === "" ? null : posterUrl.trim(),
          caption: caption.trim(),
          instagramUrl: instagramUrl.trim() === "" ? null : instagramUrl.trim(),
          productId: product?.id ?? null,
          durationSec,
          sortOrder: Number.isFinite(order) && order >= 0 ? order : 0,
          active,
        },
        reel?.id ?? null,
      );
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(reel ? "Reel updated." : "Reel added.");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const duration = formatDuration(durationSec);

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{reel ? "Edit reel" : "Add reel"}</DialogTitle>
          <DialogDescription>
            A vertical clip under {MAX_VIDEO_MB}MB. Shoppers see it muted with
            the caption over it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 sm:grid-cols-[200px_1fr]">
          {/* ---------------- clip + preview ---------------- */}
          <div className="space-y-2">
            <Label>Clip</Label>
            <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-foreground ring-1 ring-foreground/10">
              {videoUrl ? (
                <video
                  key={videoUrl}
                  src={videoUrl}
                  poster={posterUrl || undefined}
                  muted
                  loop
                  playsInline
                  autoPlay
                  preload="metadata"
                  className="size-full object-cover"
                  aria-label="Preview of the uploaded clip, muted"
                />
              ) : (
                <div className="flex size-full flex-col items-center justify-center gap-2 px-4 text-center text-background/70">
                  <Clapperboard className="size-8" aria-hidden />
                  <p className="text-xs">
                    9:16 works best — the frame shoppers see on their phone.
                  </p>
                </div>
              )}

              {video.phase === "uploading" || video.phase === "probing" ? (
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-foreground/80 px-5 text-background"
                  role="status"
                  aria-live="polite"
                >
                  <Loader2 className="size-6 animate-spin" aria-hidden />
                  <p className="text-sm font-medium tabular-nums">
                    {video.phase === "probing"
                      ? "Reading the clip…"
                      : `Uploading ${Math.round(video.fraction * 100)}%`}
                  </p>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-background/20">
                    <div
                      className="h-full rounded-full bg-background transition-[width] duration-200"
                      style={{
                        width: `${video.phase === "uploading" ? Math.round(video.fraction * 100) : 4}%`,
                      }}
                    />
                  </div>
                </div>
              ) : null}

              {caption.trim() && videoUrl && video.phase === "idle" ? (
                <p className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pt-8 pb-3 text-xs font-medium text-white">
                  {caption}
                </p>
              ) : null}

              {duration && video.phase === "idle" ? (
                <span className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white tabular-nums">
                  {duration}
                </span>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => videoInputRef.current?.click()}
              >
                <Upload className="size-4" aria-hidden />
                {videoUrl ? "Replace clip" : "Upload clip"}
              </Button>
              <input
                ref={videoInputRef}
                type="file"
                accept={VIDEO_ACCEPT_ATTR}
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadVideo(file);
                  e.target.value = "";
                }}
              />
            </div>
            {video.phase === "error" ? (
              <p className="text-xs text-destructive" role="alert">
                {video.message}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                MP4, WebM or MOV, up to {MAX_VIDEO_MB}MB. Keep it under a
                minute.
              </p>
            )}
          </div>

          {/* ---------------- details ---------------- */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor="reel-caption">Caption</Label>
                <span
                  className={
                    caption.length > MAX_REEL_CAPTION
                      ? "text-xs text-destructive tabular-nums"
                      : "text-xs text-muted-foreground tabular-nums"
                  }
                  aria-live="polite"
                >
                  {caption.length}/{MAX_REEL_CAPTION}
                </span>
              </div>
              <textarea
                id="reel-caption"
                value={caption}
                rows={3}
                maxLength={MAX_REEL_CAPTION}
                disabled={busy}
                placeholder="New boAt neckbands just landed — 3 colours, bulk packs ready."
                onChange={(e) => setCaption(e.target.value)}
                className="w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
              />
              <p className="text-xs text-muted-foreground">
                Shown over the clip and read aloud by screen readers.
              </p>
            </div>

            <ReelProductPicker value={product} onChange={setProduct} disabled={busy} />

            <div className="space-y-1.5">
              <Label htmlFor="reel-instagram">Instagram post (optional)</Label>
              <Input
                id="reel-instagram"
                type="url"
                inputMode="url"
                value={instagramUrl}
                disabled={busy}
                placeholder="https://www.instagram.com/reel/…"
                aria-invalid={instagramInvalid || undefined}
                onChange={(e) => setInstagramUrl(e.target.value)}
              />
              <p
                className={
                  instagramInvalid
                    ? "text-xs text-destructive"
                    : "text-xs text-muted-foreground"
                }
              >
                {instagramInvalid
                  ? "Must be a full https://instagram.com/… link."
                  : "Adds a “View on Instagram” button under the clip."}
              </p>
            </div>

            <PosterField
              value={posterUrl}
              busy={posterBusy}
              disabled={busy && !posterBusy}
              onPick={(file) => void uploadPoster(file)}
              onClear={() => setPosterUrl("")}
              inputRef={posterInputRef}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="reel-sort">Position</Label>
                <Input
                  id="reel-sort"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={9999}
                  value={sortOrder}
                  disabled={busy}
                  onChange={(e) => setSortOrder(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Lower shows first. The arrows on the list change this too.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reel-duration">Length (seconds)</Label>
                <Input
                  id="reel-duration"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={600}
                  value={durationSec ?? ""}
                  disabled={busy}
                  placeholder="Read from the clip"
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    setDurationSec(Number.isFinite(n) && n > 0 ? n : null);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Filled in automatically when the clip uploads.
                </p>
              </div>
            </div>

            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-input px-3 py-2.5">
              <span className="text-sm font-medium text-foreground">
                Show on the storefront
              </span>
              <Switch
                checked={active}
                disabled={busy}
                onCheckedChange={setActive}
                aria-label="Show on the storefront"
              />
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={busy || !videoUrl}
            aria-busy={saving || undefined}
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : reel ? (
              "Save changes"
            ) : (
              "Add reel"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PosterField({
  value,
  busy,
  disabled,
  onPick,
  onClear,
  inputRef,
}: {
  value: string;
  busy: boolean;
  disabled: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="space-y-1.5">
      <Label>Poster (optional)</Label>
      <div className="flex items-center gap-3">
        {value ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value}
              alt=""
              className="h-16 w-9 rounded-md border border-border object-cover"
            />
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onClear}>
              <X className="size-3.5" aria-hidden />
              Remove
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || disabled}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Uploading…
              </>
            ) : (
              <>
                <ImageIcon className="size-4" aria-hidden />
                Upload still
              </>
            )}
          </Button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_POSTER_TYPES.join(",")}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPick(file);
            e.target.value = "";
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        A still shown before the clip loads and in the home rail. Without one,
        the first frame is used.
      </p>
    </div>
  );
}
