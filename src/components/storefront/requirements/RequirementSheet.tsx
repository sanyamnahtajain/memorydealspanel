"use client";

import * as React from "react";
import imageCompression from "browser-image-compression";
import { toast } from "sonner";
import { Camera, ImagePlus, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  MAX_ATTACHMENTS,
  NOTE_MAX_CHARS,
  ATTACHMENT_MAX_BYTES,
} from "@/lib/requirement-notes";
import { presignNotePhotoAction } from "@/server/actions/note-photos";
import { setCartRequirementAction } from "@/server/actions/cart";

/**
 * RequirementSheet — the app-like bottom sheet where a customer describes
 * their requirement for one cart line: a free-text note (e.g. a model list
 * for tempered glass) plus photos, straight from the phone camera or the
 * gallery. Photos are compressed CLIENT-SIDE to JPEG (fast uploads on mobile
 * data, and JPEG embeds directly into the order PDF), uploaded to a
 * presigned key under our own storage, and saved onto the cart line.
 *
 * Controlled: the parent owns `open` so the PDP can auto-open it right after
 * an add-to-cart, and the cart page can open it from an "Edit" button.
 */

type PhotoStatus = "uploading" | "done" | "error";

interface PhotoItem {
  /** Stable client id for this tile. */
  id: string;
  /** Local object URL (instant preview) or the stored public URL. */
  previewUrl: string;
  /** The stored public URL once uploaded — what gets saved. */
  publicUrl: string | null;
  /** 0–100 while uploading. */
  progress: number;
  status: PhotoStatus;
  /** True when previewUrl is an object URL that must be revoked. */
  local: boolean;
}

let photoCounter = 0;
function nextPhotoId(): string {
  photoCounter += 1;
  return `rq_${Date.now().toString(36)}_${photoCounter}`;
}

/** Compress any picked image to a JPEG well under the upload cap. */
async function toJpeg(file: File): Promise<File> {
  const compressed = await imageCompression(file, {
    maxWidthOrHeight: 1600,
    maxSizeMB: 0.8,
    useWebWorker: true,
    fileType: "image/jpeg",
  });
  if (compressed instanceof File) return compressed;
  return new File([compressed], "photo.jpg", { type: "image/jpeg" });
}

/** PUT a blob to the presigned target, reporting byte progress. */
function putBlob(
  target: { uploadUrl: string; headers: Record<string, string> },
  blob: Blob,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", target.uploadUrl, true);
    for (const [key, value] of Object.entries(target.headers)) {
      xhr.setRequestHeader(key, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(blob);
  });
}

export interface RequirementSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  variantId?: string | null;
  productName: string;
  initialNote: string | null;
  initialAttachments: { url: string }[];
  /** Called with the server-confirmed values after a successful save. */
  onSaved?: (note: string | null, attachments: { url: string }[]) => void;
}

export function RequirementSheet({
  open,
  onOpenChange,
  productId,
  variantId = null,
  productName,
  initialNote,
  initialAttachments,
  onSaved,
}: RequirementSheetProps) {
  const [note, setNote] = React.useState(initialNote ?? "");
  const [photos, setPhotos] = React.useState<PhotoItem[]>([]);
  const [saving, setSaving] = React.useState(false);
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const galleryRef = React.useRef<HTMLInputElement>(null);

  // Re-seed from the stored line every time the sheet opens (discard edits
  // that were never saved on the previous open).
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      setNote(initialNote ?? "");
      setPhotos(
        initialAttachments.map((a) => ({
          id: nextPhotoId(),
          previewUrl: a.url,
          publicUrl: a.url,
          progress: 100,
          status: "done" as const,
          local: false,
        })),
      );
    }
    wasOpen.current = open;
  }, [open, initialNote, initialAttachments]);

  // Revoke leftover object URLs on unmount.
  React.useEffect(() => {
    return () => {
      setPhotos((prev) => {
        for (const p of prev) if (p.local) URL.revokeObjectURL(p.previewUrl);
        return prev;
      });
    };
  }, []);

  const patchPhoto = React.useCallback(
    (id: string, next: Partial<PhotoItem>) => {
      setPhotos((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...next } : p)),
      );
    },
    [],
  );

  const removePhoto = React.useCallback((id: string) => {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target?.local) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  const uploadOne = React.useCallback(
    async (file: File, item: PhotoItem) => {
      try {
        const jpeg = await toJpeg(file);
        if (jpeg.size > ATTACHMENT_MAX_BYTES) {
          throw new Error("Photo is too large even after compression.");
        }
        const target = await presignNotePhotoAction({
          contentType: "image/jpeg",
          sizeBytes: jpeg.size,
        });
        if (!target.ok) throw new Error(target.error);
        await putBlob(target, jpeg, (fraction) =>
          patchPhoto(item.id, { progress: Math.round(fraction * 100) }),
        );
        patchPhoto(item.id, {
          status: "done",
          progress: 100,
          publicUrl: target.publicUrl,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Couldn't upload the photo.";
        toast.error(message);
        removePhoto(item.id);
      }
    },
    [patchPhoto, removePhoto],
  );

  // Live mirror of the photo list so the cap check in addFiles doesn't race
  // a stale closure (batches can arrive while uploads are in flight).
  const photosRef = React.useRef(photos);
  React.useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  const addFiles = React.useCallback(
    async (list: FileList | null) => {
      if (!list || list.length === 0) return;
      const incoming = Array.from(list).filter((f) => {
        if (!f.type.startsWith("image/")) {
          toast.error(`"${f.name}" is not an image.`);
          return false;
        }
        return true;
      });
      const room = Math.max(0, MAX_ATTACHMENTS - photosRef.current.length);
      if (incoming.length > room) {
        toast.error(`Up to ${MAX_ATTACHMENTS} photos per product.`);
      }
      const accepted = incoming.slice(0, room).map((file) => ({
        file,
        item: {
          id: nextPhotoId(),
          previewUrl: URL.createObjectURL(file),
          publicUrl: null,
          progress: 0,
          status: "uploading" as const,
          local: true,
        } satisfies PhotoItem,
      }));
      if (accepted.length === 0) return;
      setPhotos((prev) => [...prev, ...accepted.map((a) => a.item)]);
      // Sequential keeps the compressor + mobile network calm.
      for (const { file, item } of accepted) {
        await uploadOne(file, item);
      }
    },
    [uploadOne],
  );

  const uploading = photos.some((p) => p.status === "uploading");
  const savedUrls = photos
    .filter((p) => p.status === "done" && p.publicUrl)
    .map((p) => ({ url: p.publicUrl as string }));

  async function handleSave() {
    setSaving(true);
    try {
      const result = await setCartRequirementAction({
        productId,
        ...(variantId ? { variantId } : {}),
        note,
        attachments: savedUrls,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      onSaved?.(result.note, result.attachments);
      onOpenChange(false);
      toast.success("Requirement saved with your item.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[85dvh] max-w-lg overflow-y-auto rounded-t-2xl p-4"
      >
        <SheetHeader className="p-0 pb-3">
          <SheetTitle>Your requirement</SheetTitle>
          <SheetDescription>
            For {productName} — write your list (models, quantities…) or attach
            photos of it. Our team prepares your order from this.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="requirement-note"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Note
            </label>
            <textarea
              id="requirement-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX_CHARS))}
              maxLength={NOTE_MAX_CHARS}
              rows={5}
              disabled={saving}
              placeholder={"e.g.\n20 × Realme 11\n20 × Galaxy S23 Ultra\n10 × iPhone 15 Pro…"}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            />
            <p className="mt-1 text-right text-[0.65rem] text-muted-foreground tabular-nums">
              {note.length}/{NOTE_MAX_CHARS}
            </p>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Photos ({photos.length}/{MAX_ATTACHMENTS})
            </p>
            <div className="grid grid-cols-3 gap-2">
              {photos.map((p) => (
                <div
                  key={p.id}
                  className="relative aspect-square overflow-hidden rounded-lg border border-border bg-muted"
                >
                  {/* Local object URLs / storage originals — next/image adds
                      nothing here and object URLs break it. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.previewUrl}
                    alt="Requirement photo"
                    className={cn(
                      "h-full w-full object-cover",
                      p.status === "uploading" && "opacity-50",
                    )}
                  />
                  {p.status === "uploading" ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/40">
                      <Loader2 className="size-5 animate-spin text-foreground" />
                      <span className="text-[0.65rem] font-medium tabular-nums">
                        {p.progress}%
                      </span>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => removePhoto(p.id)}
                    disabled={saving}
                    aria-label="Remove photo"
                    className="absolute top-1 right-1 rounded-full bg-background/90 p-1 shadow-sm transition-colors hover:bg-background"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}

              {photos.length < MAX_ATTACHMENTS ? (
                <>
                  <button
                    type="button"
                    onClick={() => cameraRef.current?.click()}
                    disabled={saving}
                    className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
                  >
                    <Camera className="size-5" aria-hidden />
                    <span className="text-[0.65rem] font-medium">Camera</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => galleryRef.current?.click()}
                    disabled={saving}
                    className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
                  >
                    <ImagePlus className="size-5" aria-hidden />
                    <span className="text-[0.65rem] font-medium">Gallery</span>
                  </button>
                </>
              ) : null}
            </div>

            {/* Hidden inputs: camera capture (mobile) vs. multi-select gallery. */}
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={galleryRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          <Button
            type="button"
            className="w-full pointer-coarse:min-h-11"
            disabled={saving || uploading}
            aria-busy={saving || undefined}
            onClick={handleSave}
          >
            {saving
              ? "Saving…"
              : uploading
                ? "Uploading photos…"
                : "Save requirement"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
