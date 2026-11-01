"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import imageCompression from "browser-image-compression";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  EyeOff,
  ImageIcon,
  ImageOff,
  Loader2,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  MAX_BRAND_CATEGORY_LABEL,
  MAX_BRAND_TAGLINE,
} from "@/lib/brand-layout";
import { createBrandLogoUploadTargetAction, saveBrandPageAction } from "@/server/actions/brands";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** One category row in the editor (the server resolves names and counts). */
export interface EditorCategory {
  categoryId: string;
  /** The catalogue's own name (the placeholder for the label override). */
  name: string;
  /** The catalogue's own photo (used when no brand photo is set). */
  defaultImage: string | null;
  /** Visible products of this brand in the category right now. */
  count: number;
  /** Brand-specific photo, or null for the default. */
  image: string | null;
  /** Display-name override ("" = the catalogue name). */
  label: string;
  hidden: boolean;
}

export interface EditorBrand {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  active: boolean;
  coverImage: string | null;
  tagline: string;
}

/**
 * Upload one image through the brand upload target, compressed in the browser
 * first (every shopper downloads it, so the 4 MB export from a phone camera
 * never ships). Returns the public URL or null after a toast.
 */
async function uploadImage(file: File, maxEdge: number): Promise<string | null> {
  if (!file.type.startsWith("image/")) {
    toast.error("Choose a JPG, PNG or WebP image.");
    return null;
  }
  try {
    const compressed = await imageCompression(file, {
      maxSizeMB: 1,
      maxWidthOrHeight: maxEdge,
      useWebWorker: true,
    });
    const contentType = compressed.type || file.type || "image/jpeg";
    const target = await createBrandLogoUploadTargetAction({ fileName: file.name, contentType });
    if (!target.ok) {
      toast.error(target.error);
      return null;
    }
    const res = await fetch(target.data.uploadUrl, {
      method: "PUT",
      headers: target.data.headers,
      body: compressed,
    });
    if (!res.ok) {
      toast.error("The upload failed. Please try again.");
      return null;
    }
    return target.data.publicUrl;
  } catch {
    toast.error("That image could not be processed.");
    return null;
  }
}

/** A hidden file input driven by a visible button. */
function PickImage({
  onPick,
  busy,
  label,
  className,
}: {
  onPick: (file: File) => void;
  busy: boolean;
  label: string;
  className?: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onPick(file);
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => ref.current?.click()}
        className={className}
      >
        {busy ? <Loader2 aria-hidden className="animate-spin" /> : <Upload aria-hidden />}
        {label}
      </Button>
    </>
  );
}

export function BrandPageEditor({
  brand,
  initialRows,
}: {
  brand: EditorBrand;
  initialRows: EditorCategory[];
}) {
  const router = useRouter();
  const [coverImage, setCoverImage] = React.useState<string | null>(brand.coverImage);
  const [tagline, setTagline] = React.useState(brand.tagline);
  const [rows, setRows] = React.useState<EditorCategory[]>(initialRows);
  const [uploading, setUploading] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  const touch = () => setDirty(true);

  function updateRow(categoryId: string, patch: Partial<EditorCategory>) {
    setRows((prev) => prev.map((r) => (r.categoryId === categoryId ? { ...r, ...patch } : r)));
    touch();
  }

  function move(index: number, delta: -1 | 1) {
    setRows((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      const [row] = next.splice(index, 1);
      next.splice(target, 0, row!);
      return next;
    });
    touch();
  }

  async function pickCover(file: File) {
    setUploading("cover");
    const url = await uploadImage(file, 1920);
    setUploading(null);
    if (url) {
      setCoverImage(url);
      touch();
    }
  }

  async function pickRowImage(categoryId: string, file: File) {
    setUploading(categoryId);
    const url = await uploadImage(file, 640);
    setUploading(null);
    if (url) updateRow(categoryId, { image: url });
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await saveBrandPageAction({
        brandId: brand.id,
        coverImage,
        tagline: tagline.trim() === "" ? null : tagline.trim(),
        layout: rows.map((r) => ({
          categoryId: r.categoryId,
          image: r.image,
          label: r.label.trim() === "" ? null : r.label.trim(),
          hidden: r.hidden,
        })),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Brand page saved.");
      setDirty(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const visibleCount = rows.filter((r) => !r.hidden && r.count > 0).length;

  return (
    <div className="space-y-6">
      {/* ---- Header: cover + tagline + position ---- */}
      <section className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Top of the page</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A wide picture across the top (3:1 works best), and one short line about the brand.
          </p>
        </div>

        <div className="relative aspect-[3/1] w-full overflow-hidden rounded-xl border border-dashed border-border bg-muted/40">
          {coverImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverImage} alt="" className="size-full object-cover" />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
              <ImageIcon aria-hidden className="size-6" />
              <span className="text-xs">No cover — the page shows the logo and name instead.</span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PickImage
            onPick={(f) => void pickCover(f)}
            busy={uploading === "cover"}
            label={coverImage ? "Replace cover" : "Upload cover"}
          />
          {coverImage ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setCoverImage(null);
                touch();
              }}
            >
              <X aria-hidden />
              Remove
            </Button>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="brand-tagline">Line under the name</Label>
            <span className="font-tabular text-xs text-muted-foreground">
              {tagline.length}/{MAX_BRAND_TAGLINE}
            </span>
          </div>
          <Input
            id="brand-tagline"
            value={tagline}
            maxLength={MAX_BRAND_TAGLINE}
            placeholder="India's #1 audio brand — earbuds, neckbands, speakers"
            onChange={(e) => {
              setTagline(e.target.value);
              touch();
            }}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          Where this brand sits among the others on the home page is set on{" "}
          <Link
            href="/admin/brands?arrange=1"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Brands → Arrange
          </Link>
          .
        </p>
      </section>

      {/* ---- Category rail ---- */}
      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Categories on the brand page</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The rail down the left of the brand page, top to bottom. Give each one this brand&rsquo;s own
              photo and name, or hide it. New categories appear at the end automatically.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {visibleCount} of {rows.length} showing
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="mt-4 rounded-lg bg-muted/50 px-3 py-6 text-center text-sm text-muted-foreground">
            This brand has no products yet. Its categories will appear here once products are added.
          </p>
        ) : (
          <ol className="mt-4 divide-y divide-border/70">
            {rows.map((row, index) => {
              const shown = row.image ?? row.defaultImage;
              const empty = row.count === 0;
              return (
                <li
                  key={row.categoryId}
                  className={cn("flex flex-col gap-3 py-3 sm:flex-row sm:items-center", row.hidden && "opacity-60")}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex flex-col gap-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Move ${row.name} up`}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Move ${row.name} down`}
                        disabled={index === rows.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown aria-hidden />
                      </Button>
                    </div>
                    <span className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#EEF4F7] text-muted-foreground">
                      {shown ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={shown} alt="" className="size-full object-cover" />
                      ) : (
                        <ImageOff aria-hidden className="size-5" />
                      )}
                      {row.image ? (
                        <span className="absolute right-0.5 bottom-0.5 rounded bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
                          Brand
                        </span>
                      ) : null}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <Input
                        aria-label={`Name for ${row.name} on this brand's page`}
                        value={row.label}
                        maxLength={MAX_BRAND_CATEGORY_LABEL}
                        placeholder={row.name}
                        onChange={(e) => updateRow(row.categoryId, { label: e.target.value })}
                        className="h-9"
                      />
                      <p className="text-xs text-muted-foreground">
                        {empty ? "No products now — kept for later" : `${row.count} product${row.count === 1 ? "" : "s"}`}
                        {row.label.trim() ? ` · catalogue name: ${row.name}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-11 sm:pl-0">
                    <PickImage
                      onPick={(f) => void pickRowImage(row.categoryId, f)}
                      busy={uploading === row.categoryId}
                      label={row.image ? "Replace" : "Photo"}
                    />
                    {row.image ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => updateRow(row.categoryId, { image: null })}
                        aria-label={`Use the catalogue photo for ${row.name}`}
                      >
                        <RotateCcw aria-hidden />
                        Default
                      </Button>
                    ) : null}
                    <label className="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground sm:ml-2">
                      <EyeOff aria-hidden className="size-3.5" />
                      Hide
                      <Switch
                        checked={row.hidden}
                        onCheckedChange={(checked) => updateRow(row.categoryId, { hidden: Boolean(checked) })}
                        aria-label={`Hide ${row.name} on this brand's page`}
                      />
                    </label>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* ---- Save bar ---- */}
      {/* Sticky inside the admin's own scroll area (the shell scrolls <main>,
          with the phone nav outside it), so it always sits above that nav. */}
      <div className="sticky bottom-0 z-20 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={`/b/${brand.slug}`}
            target="_blank"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            <ExternalLink aria-hidden className="size-4" />
            View page
          </Link>
          <div className="flex items-center gap-3">
            {dirty ? <span className="hidden text-xs text-muted-foreground sm:inline">Unsaved changes</span> : null}
            <Button type="button" onClick={() => void save()} disabled={!dirty || saving || uploading !== null}>
              {saving ? <Loader2 aria-hidden className="animate-spin" /> : null}
              Save changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
