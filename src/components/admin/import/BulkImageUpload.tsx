"use client";

/**
 * BulkImageUpload — attach many product photos in one pass by matching each
 * filename to a product SKU.
 *
 * Flow:
 *   1. Pick multiple files (or a whole folder). Filenames like `SKU123-1.jpg`
 *      carry the target SKU as their leading token.
 *   2. `matchImagesToSkus` builds a plan: which file → which product, plus a
 *      list of unmatched files (no SKU, or an unknown SKU). We render a review
 *      screen so the admin can sanity-check before anything is written.
 *   3. On confirm, each MATCHED, non-at-capacity file runs the existing image
 *      pipeline — compress (lib/image) → presignUpload → PUT → attachImageToProduct
 *      — sequentially, with per-file progress. The plan is refreshed after the
 *      run so re-uploads reflect the new image counts.
 *
 * Reuses the exact server flow the single-product editor uses; it never
 * bypasses the per-product cap (`attachImageToProduct` enforces it server-side
 * and we also skip files whose product is already at capacity).
 */

import * as React from "react";
import { toast } from "sonner";
import {
  CheckCircle2Icon,
  FolderUpIcon,
  ImagePlusIcon,
  Loader2Icon,
  TriangleAlertIcon,
  UploadCloudIcon,
  XCircleIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageHeader, EmptyState } from "@/components/common";
import { IMAGE_ACCEPT_ATTR, ImageError, prepareImage } from "@/lib/image";
import {
  attachImageToProduct,
  presignUpload,
} from "@/server/actions/images";
import {
  matchImagesToSkus,
  type MatchPlan,
  type MatchedImage,
} from "@/server/actions/bulk-images";

// ---------------------------------------------------------------------------
// Per-file upload state
// ---------------------------------------------------------------------------

type UploadStatus =
  | "pending"
  | "compressing"
  | "uploading"
  | "saving"
  | "done"
  | "skipped"
  | "error";

interface UploadState {
  status: UploadStatus;
  /** 0–100 within the active phase. */
  progress: number;
  error?: string;
}

const IDLE_STATE: UploadState = { status: "pending", progress: 0 };

// ---------------------------------------------------------------------------
// Upload helper (mirrors use-image-uploads' PUT contract)
// ---------------------------------------------------------------------------

function putBlob(
  target: { uploadUrl: string; headers: Record<string, string> },
  blob: Blob,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
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

/** Run the full compress → presign → PUT → attach pipeline for one file. */
async function uploadOne(
  productId: string,
  file: File,
  onPhase: (state: UploadState) => void,
): Promise<void> {
  onPhase({ status: "compressing", progress: 0 });
  const { full, thumb } = await prepareImage(file);

  onPhase({ status: "uploading", progress: 0 });
  const fullTarget = await presignUpload(productId, full.name, full.type);
  if (!fullTarget.ok) {
    throw new ImageError(fullTarget.error);
  }
  await putBlob(fullTarget, full, (fraction) =>
    onPhase({ status: "uploading", progress: Math.round(fraction * 90) }),
  );

  // Thumbnail is best-effort — a failure here still attaches the full image.
  let thumbUrl: string | undefined;
  try {
    const thumbTarget = await presignUpload(productId, thumb.name, thumb.type);
    if (thumbTarget.ok) {
      await putBlob(thumbTarget, thumb);
      thumbUrl = thumbTarget.publicUrl;
    }
  } catch {
    thumbUrl = undefined;
  }

  onPhase({ status: "saving", progress: 95 });
  const attached = await attachImageToProduct(productId, {
    url: fullTarget.publicUrl,
    thumbUrl,
  });
  if (!attached.ok) {
    throw new ImageError(attached.error);
  }
  onPhase({ status: "done", progress: 100 });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Files keyed by filename so the plan (which only carries names) can find them. */
type FileMap = Map<string, File>;

export function BulkImageUpload() {
  const [files, setFiles] = React.useState<FileMap>(new Map());
  const [plan, setPlan] = React.useState<MatchPlan | null>(null);
  const [isMatching, setIsMatching] = React.useState(false);
  const [isUploading, setIsUploading] = React.useState(false);
  const [states, setStates] = React.useState<Record<string, UploadState>>({});

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const folderInputRef = React.useRef<HTMLInputElement>(null);

  const reset = React.useCallback(() => {
    setFiles(new Map());
    setPlan(null);
    setStates({});
  }, []);

  const handlePicked = React.useCallback(
    async (picked: FileList | null) => {
      if (!picked || picked.length === 0) {
        return;
      }
      const map: FileMap = new Map();
      for (const file of Array.from(picked)) {
        // Later files with the same name win; last selection is authoritative.
        map.set(file.name, file);
      }
      setFiles(map);
      setStates({});
      setPlan(null);

      setIsMatching(true);
      try {
        const result = await matchImagesToSkus(
          Array.from(map.keys()).map((filename) => ({ filename })),
        );
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        setPlan(result.plan);
        if (result.plan.matched.length === 0) {
          toast.warning("No files matched a product SKU.");
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not match the images.",
        );
      } finally {
        setIsMatching(false);
      }
    },
    [],
  );

  const setFileState = React.useCallback(
    (filename: string, next: UploadState) => {
      setStates((prev) => ({ ...prev, [filename]: next }));
    },
    [],
  );

  const uploadable = React.useMemo(
    () => (plan ? plan.matched.filter((m) => !m.atCapacity) : []),
    [plan],
  );

  const handleConfirm = React.useCallback(async () => {
    if (!plan || uploadable.length === 0) {
      return;
    }
    setIsUploading(true);
    let succeeded = 0;
    let failed = 0;

    // Flag at-capacity matches as skipped up front for clear feedback.
    for (const match of plan.matched) {
      if (match.atCapacity) {
        setFileState(match.filename, { status: "skipped", progress: 0 });
      }
    }

    // Sequential to keep the worker + network calm (mirrors single-product flow).
    for (const match of uploadable) {
      const file = files.get(match.filename);
      if (!file) {
        setFileState(match.filename, {
          status: "error",
          progress: 0,
          error: "File is no longer available.",
        });
        failed += 1;
        continue;
      }
      try {
        await uploadOne(match.productId, file, (state) =>
          setFileState(match.filename, state),
        );
        succeeded += 1;
      } catch (error) {
        const message =
          error instanceof ImageError || error instanceof Error
            ? error.message
            : "Upload failed";
        setFileState(match.filename, {
          status: "error",
          progress: 0,
          error: message,
        });
        failed += 1;
      }
    }

    setIsUploading(false);
    if (succeeded > 0) {
      toast.success(
        `Uploaded ${succeeded} image${succeeded === 1 ? "" : "s"}.`,
      );
    }
    if (failed > 0) {
      toast.error(`${failed} image${failed === 1 ? "" : "s"} failed.`);
    }

    // Refresh the plan so image counts / capacity reflect what we just wrote.
    try {
      const refreshed = await matchImagesToSkus(
        Array.from(files.keys()).map((filename) => ({ filename })),
      );
      if (refreshed.ok) {
        setPlan(refreshed.plan);
      }
    } catch {
      // Non-fatal: the on-screen per-file statuses already show the outcome.
    }
  }, [plan, uploadable, files, setFileState]);

  const hasSelection = files.size > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Bulk image upload"
        description="Match photos to products by SKU in the filename (e.g. SKU123-1.jpg), then attach them all at once."
        actions={
          hasSelection ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
              disabled={isUploading || isMatching}
            >
              Clear
            </Button>
          ) : undefined
        }
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={IMAGE_ACCEPT_ATTR}
        className="sr-only"
        onChange={(event) => {
          void handlePicked(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        accept={IMAGE_ACCEPT_ATTR}
        className="sr-only"
        // webkitdirectory lets an admin drop an entire export folder of photos.
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={(event) => {
          void handlePicked(event.target.files);
          event.target.value = "";
        }}
      />

      {!hasSelection ? (
        <EmptyState
          illustration="empty-box"
          title="No images selected"
          description="Choose product photos or a folder. Each filename should start with the product SKU."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={isMatching}
              >
                <ImagePlusIcon aria-hidden />
                Select images
              </Button>
              <Button
                variant="outline"
                onClick={() => folderInputRef.current?.click()}
                disabled={isMatching}
              >
                <FolderUpIcon aria-hidden />
                Select folder
              </Button>
            </div>
          }
        />
      ) : isMatching ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card p-10 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" aria-hidden />
          Matching {files.size} file{files.size === 1 ? "" : "s"} to products…
        </div>
      ) : plan ? (
        <ReviewScreen
          plan={plan}
          states={states}
          isUploading={isUploading}
          uploadableCount={uploadable.length}
          onConfirm={handleConfirm}
          onAddMore={() => fileInputRef.current?.click()}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review screen
// ---------------------------------------------------------------------------

interface ReviewScreenProps {
  plan: MatchPlan;
  states: Record<string, UploadState>;
  isUploading: boolean;
  uploadableCount: number;
  onConfirm: () => void;
  onAddMore: () => void;
}

function ReviewScreen({
  plan,
  states,
  isUploading,
  uploadableCount,
  onConfirm,
  onAddMore,
}: ReviewScreenProps) {
  const { matched, unmatched, total } = plan;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <Summary label="Files" value={total} />
        <Summary label="Matched" value={matched.length} tone="success" />
        <Summary label="Unmatched" value={unmatched.length} tone="warning" />
        <div className="ms-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onAddMore}
            disabled={isUploading}
          >
            Add more
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isUploading || uploadableCount === 0}
          >
            {isUploading ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : (
              <UploadCloudIcon aria-hidden />
            )}
            {isUploading
              ? "Uploading…"
              : `Upload ${uploadableCount} image${uploadableCount === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>

      {matched.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-foreground">
            Matched ({matched.length})
          </h3>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {matched.map((match) => (
              <MatchedRow
                key={match.filename}
                match={match}
                state={states[match.filename] ?? IDLE_STATE}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {unmatched.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-foreground">
            Unmatched ({unmatched.length})
          </h3>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {unmatched.map((item) => (
              <li
                key={item.filename}
                className="flex items-center gap-3 px-4 py-2.5 text-sm"
              >
                <TriangleAlertIcon
                  className="size-4 shrink-0 text-warning"
                  aria-hidden
                />
                <span className="truncate font-mono text-xs text-foreground">
                  {item.filename}
                </span>
                <span className="ms-auto shrink-0 text-xs text-muted-foreground">
                  {item.reason === "no-sku"
                    ? "No SKU in filename"
                    : `Unknown SKU${item.sku ? ` "${item.sku}"` : ""}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Summary({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "success" | "warning";
}) {
  return (
    <div className="flex flex-col">
      <span
        className={cn(
          "text-lg font-semibold tabular-nums",
          tone === "success" && "text-success",
          tone === "warning" && value > 0 && "text-warning",
          tone === "default" && "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Matched row
// ---------------------------------------------------------------------------

function MatchedRow({
  match,
  state,
}: {
  match: MatchedImage;
  state: UploadState;
}) {
  const isActive =
    state.status === "compressing" ||
    state.status === "uploading" ||
    state.status === "saving";

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-sm">
      <StatusIcon status={state.status} atCapacity={match.atCapacity} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-xs text-foreground">
            {match.filename}
          </span>
          <span className="shrink-0 text-muted-foreground">→</span>
          <span className="truncate text-foreground">{match.productName}</span>
        </div>
        {isActive ? (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${state.progress}%` }}
            />
          </div>
        ) : state.status === "error" && state.error ? (
          <p className="mt-0.5 text-xs text-destructive">{state.error}</p>
        ) : null}
      </div>
      <div className="ms-auto flex shrink-0 items-center gap-2">
        <span className="inline-flex h-5 w-fit shrink-0 items-center rounded-full border border-border bg-muted px-2 font-mono text-xs text-muted-foreground">
          {match.productSku}
        </span>
        {match.atCapacity ? (
          <span className="text-xs text-warning">At capacity</span>
        ) : (
          <span className="text-xs text-muted-foreground tabular-nums">
            {match.currentImageCount} img
          </span>
        )}
      </div>
    </li>
  );
}

function StatusIcon({
  status,
  atCapacity,
}: {
  status: UploadStatus;
  atCapacity: boolean;
}) {
  if (status === "done") {
    return (
      <CheckCircle2Icon className="size-4 shrink-0 text-success" aria-hidden />
    );
  }
  if (status === "error") {
    return (
      <XCircleIcon className="size-4 shrink-0 text-destructive" aria-hidden />
    );
  }
  if (
    status === "compressing" ||
    status === "uploading" ||
    status === "saving"
  ) {
    return (
      <Loader2Icon
        className="size-4 shrink-0 animate-spin text-primary"
        aria-hidden
      />
    );
  }
  if (status === "skipped" || atCapacity) {
    return (
      <TriangleAlertIcon className="size-4 shrink-0 text-warning" aria-hidden />
    );
  }
  return (
    <ImagePlusIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
  );
}
