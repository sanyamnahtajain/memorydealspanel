"use client";

import * as React from "react";
import imageCompression from "browser-image-compression";
import { ImageIcon, Loader2Icon, UploadIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/components/common";
import { createCategoryImageUploadTargetAction } from "@/server/actions/categories";

export interface CategoryFormValues {
  name: string;
  image: string | null;
  status: "ACTIVE" | "INACTIVE";
  /** Default HSN/SAC code for products in this category, or null when unset. */
  defaultHsnCode: string | null;
  /** Default GST rate as a PERCENT (e.g. 18), or null when unset. */
  defaultGstRatePercent: number | null;
}

interface CategoryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  /** Show the HSN / GST-default fields. False (default) ⇒ pre-GST behaviour. */
  showTaxDefaults?: boolean;
  /** Initial field values (for editing). Omit for a blank create form. */
  initial?: Partial<CategoryFormValues>;
  /**
   * Persists the form. Returns an error string to keep the surface open and
   * show the message inline, or null/undefined on success (surface closes).
   */
  onSubmit: (values: CategoryFormValues) => Promise<string | null | undefined>;
}

const MAX_UPLOAD_MB = 1;

/**
 * Add / edit category surface — a centered Dialog on desktop, a bottom Sheet
 * on mobile. The stateful form (`CategoryFormBody`) is remounted on every open
 * via `openKey`, so it always initializes fresh from `initial` without a
 * sync-in-effect. The parent owns persistence via `onSubmit`.
 */
export function CategoryFormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  showTaxDefaults = false,
  initial,
  onSubmit,
}: CategoryFormDialogProps) {
  const isMobile = useIsMobile();
  // Bumped each time the surface transitions closed -> open, so the body
  // remounts with fresh state derived from `initial` (no reset effect needed).
  const [openKey, setOpenKey] = React.useState(0);
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setOpenKey((k) => k + 1);
  }

  const shared = {
    title,
    description,
    submitLabel,
    showTaxDefaults,
    initial,
    onSubmit,
    onRequestClose: () => onOpenChange(false),
  };

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[90dvh] overflow-y-auto rounded-t-2xl pb-[calc(1rem+env(safe-area-inset-bottom))]"
        >
          <div
            aria-hidden
            className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted"
          />
          {open ? (
            <CategoryFormBody key={openKey} layout="sheet" {...shared} />
          ) : null}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton>
        {open ? (
          <CategoryFormBody key={openKey} layout="dialog" {...shared} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

interface CategoryFormBodyProps {
  layout: "dialog" | "sheet";
  title: string;
  description?: string;
  submitLabel: string;
  showTaxDefaults: boolean;
  initial?: Partial<CategoryFormValues>;
  onSubmit: (values: CategoryFormValues) => Promise<string | null | undefined>;
  onRequestClose: () => void;
}

/**
 * Stateful body of the category form. Mounted fresh on each open so its state
 * derives directly from `initial` — no reset effect needed.
 */
function CategoryFormBody({
  layout,
  title,
  description,
  submitLabel,
  showTaxDefaults,
  initial,
  onSubmit,
  onRequestClose,
}: CategoryFormBodyProps) {
  const [name, setName] = React.useState(initial?.name ?? "");
  const [image, setImage] = React.useState<string | null>(
    initial?.image ?? null,
  );
  const [status, setStatus] = React.useState<"ACTIVE" | "INACTIVE">(
    initial?.status ?? "ACTIVE",
  );
  const [hsn, setHsn] = React.useState(initial?.defaultHsnCode ?? "");
  const [gstPercent, setGstPercent] = React.useState(
    initial?.defaultGstRatePercent != null
      ? String(initial.defaultGstRatePercent)
      : "",
  );
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const busy = saving || uploading;

  const handleFile = React.useCallback(async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: MAX_UPLOAD_MB,
        maxWidthOrHeight: 1024,
        useWebWorker: true,
      });
      const contentType = compressed.type || file.type || "image/jpeg";
      const target = await createCategoryImageUploadTargetAction({
        fileName: file.name,
        contentType,
      });
      if (!target.ok) {
        setError(target.error);
        return;
      }
      const res = await fetch(target.data.uploadUrl, {
        method: "PUT",
        headers: target.data.headers,
        body: compressed,
      });
      if (!res.ok) {
        setError("Upload failed. Please try again.");
        return;
      }
      setImage(target.data.publicUrl);
    } catch {
      setError("Could not process that image.");
    } finally {
      setUploading(false);
    }
  }, []);

  const handleSubmit = React.useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError("Name must be at least 2 characters.");
      return;
    }

    // GST default rate: blank = null (inherit); otherwise a valid 0–100 percent.
    let defaultGstRatePercent: number | null = null;
    if (showTaxDefaults && gstPercent.trim() !== "") {
      const pct = Number(gstPercent);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        setError("Enter a GST rate between 0 and 100%.");
        return;
      }
      defaultGstRatePercent = pct;
    }
    const defaultHsnCode =
      showTaxDefaults && hsn.trim() !== "" ? hsn.trim() : null;

    setSaving(true);
    setError(null);
    try {
      const result = await onSubmit({
        name: trimmed,
        image,
        status,
        defaultHsnCode,
        defaultGstRatePercent,
      });
      if (result) {
        setError(result);
        return;
      }
      onRequestClose();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [name, image, status, hsn, gstPercent, showTaxDefaults, onSubmit, onRequestClose]);

  const fields = (
    <div className="flex flex-col gap-4 px-4 md:px-0">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="category-name">Name</Label>
        <Input
          id="category-name"
          value={name}
          autoFocus
          placeholder="e.g. Fast Chargers"
          maxLength={80}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleSubmit();
            }
          }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="category-image">Image (optional)</Label>
        <div className="flex items-center gap-3">
          <div className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" className="size-full object-cover" />
            ) : (
              <ImageIcon
                className="size-5 text-muted-foreground"
                aria-hidden
              />
            )}
            {image ? (
              <button
                type="button"
                onClick={() => setImage(null)}
                disabled={busy}
                aria-label="Remove image"
                className="absolute top-0.5 right-0.5 inline-flex size-5 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm outline-none transition-transform hover:bg-background focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-90"
              >
                <XIcon className="size-3" aria-hidden />
              </button>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Input
              id="category-image"
              type="url"
              inputMode="url"
              value={image ?? ""}
              placeholder="Paste an image URL"
              disabled={busy}
              onChange={(event) =>
                setImage(
                  event.target.value.trim() === ""
                    ? null
                    : event.target.value,
                )
              }
            />
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleFile(file);
                  event.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2Icon className="animate-spin" aria-hidden />
                ) : (
                  <UploadIcon aria-hidden />
                )}
                {uploading ? "Uploading…" : "Upload"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Visibility</Label>
        <div className="grid grid-cols-2 gap-2">
          <StatusChoice
            active={status === "ACTIVE"}
            disabled={busy}
            label="Active"
            hint="Visible on storefront"
            onClick={() => setStatus("ACTIVE")}
          />
          <StatusChoice
            active={status === "INACTIVE"}
            disabled={busy}
            label="Inactive"
            hint="Hidden from storefront"
            onClick={() => setStatus("INACTIVE")}
          />
        </div>
      </div>

      {showTaxDefaults ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category-hsn">Default HSN (optional)</Label>
            <Input
              id="category-hsn"
              value={hsn}
              placeholder="e.g. 8523"
              maxLength={16}
              disabled={busy}
              className="font-tabular"
              onChange={(event) => setHsn(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category-gst">Default GST % (optional)</Label>
            <div className="relative">
              <Input
                id="category-gst"
                inputMode="decimal"
                value={gstPercent}
                placeholder="18"
                disabled={busy}
                className="pr-7 font-tabular"
                onChange={(event) =>
                  setGstPercent(event.target.value.replace(/[^\d.]/g, ""))
                }
              />
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted-foreground"
              >
                %
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );

  const submitButton = (
    <Button
      disabled={busy}
      onClick={handleSubmit}
      data-loading={saving || undefined}
    >
      {saving ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
      {submitLabel}
    </Button>
  );
  const cancelButton = (
    <Button variant="outline" disabled={busy} onClick={onRequestClose}>
      Cancel
    </Button>
  );

  if (layout === "sheet") {
    return (
      <>
        <SheetHeader className="pb-0 text-center">
          <SheetTitle>{title}</SheetTitle>
          {description ? (
            <SheetDescription>{description}</SheetDescription>
          ) : null}
        </SheetHeader>
        {fields}
        <SheetFooter className="pt-2">
          {submitButton}
          {cancelButton}
        </SheetFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description ? (
          <DialogDescription>{description}</DialogDescription>
        ) : null}
      </DialogHeader>
      {fields}
      <DialogFooter>
        {cancelButton}
        {submitButton}
      </DialogFooter>
    </>
  );
}

function StatusChoice({
  active,
  disabled,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
        active
          ? "border-primary bg-primary/10"
          : "border-border bg-transparent hover:bg-muted",
      )}
    >
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </button>
  );
}
