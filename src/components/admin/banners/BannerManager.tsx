"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { StatusChip } from "@/components/common/StatusChip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BANNER_PLACEMENTS,
  MAX_BANNER_ALT,
  bannerStatusReason,
  type BannerPlacement,
} from "@/lib/banners";
import {
  deleteBannerAction,
  presignBannerUpload,
  reorderBannersAction,
  saveBannerAction,
} from "@/server/actions/banners";
import type { AdminBanner } from "@/server/services/banners";

/**
 * Banner management, one section per slot.
 *
 * The list shows WHY a banner isn't live ("Scheduled", "Finished", "Turned
 * off") rather than just hiding it — "I saved it and nothing happened" is the
 * failure mode a scheduled banner invites.
 */

const ACCEPT = "image/jpeg,image/png,image/webp";

export function BannerManager({ banners }: { banners: AdminBanner[] }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<
    { banner: AdminBanner | null; placement: BannerPlacement } | null
  >(null);
  const [busy, setBusy] = React.useState(false);
  // Captured once per render pass so every row judges "live" against the same
  // instant — rows computing their own `new Date()` can disagree mid-list.
  const now = React.useMemo(() => new Date(), []);

  async function move(list: AdminBanner[], index: number, delta: number) {
    const next = [...list];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setBusy(true);
    try {
      const res = await reorderBannersAction(
        next[0].placement,
        next.map((b) => b.id),
      );
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(banner: AdminBanner) {
    if (!window.confirm("Remove this banner from the storefront?")) return;
    setBusy(true);
    try {
      const res = await deleteBannerAction(banner.id);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success("Banner removed.");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      {BANNER_PLACEMENTS.map((placement) => {
        const list = banners.filter((b) => b.placement === placement.key);
        return (
          <section key={placement.key} className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-heading text-lg font-semibold text-foreground">
                  {placement.label}
                </h2>
                <p className="text-xs text-muted-foreground">{placement.hint}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  setEditing({ banner: null, placement: placement.key })
                }
              >
                <Plus className="size-4" aria-hidden />
                Add banner
              </Button>
            </div>

            {list.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
                No banners here yet. This slot simply doesn&rsquo;t render.
              </p>
            ) : (
              <ul className="space-y-2">
                {list.map((banner, index) => {
                  const reason = bannerStatusReason(banner, now);
                  return (
                    <li
                      key={banner.id}
                      className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-2.5"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={banner.mobileImageUrl ?? banner.imageUrl}
                        alt=""
                        className="h-14 w-28 shrink-0 rounded-lg object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {banner.alt}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {banner.href ? (
                            <span className="inline-flex items-center gap-1">
                              <ExternalLink className="size-3" aria-hidden />
                              {banner.href}
                            </span>
                          ) : (
                            "Not clickable"
                          )}
                        </p>
                      </div>

                      <StatusChip
                        variant={reason ? "inactive" : "active"}
                        label={reason ?? "Live"}
                      />

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label="Move up"
                          disabled={busy || index === 0}
                          onClick={() => void move(list, index, -1)}
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                        >
                          <ArrowUp className="size-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label="Move down"
                          disabled={busy || index === list.length - 1}
                          onClick={() => void move(list, index, 1)}
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                        >
                          <ArrowDown className="size-4" aria-hidden />
                        </button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            setEditing({ banner, placement: placement.key })
                          }
                        >
                          Edit
                        </Button>
                        <button
                          type="button"
                          aria-label="Remove banner"
                          disabled={busy}
                          onClick={() => void remove(banner)}
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-40"
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      {editing ? (
        <BannerDialog
          key={editing.banner?.id ?? `new-${editing.placement}`}
          banner={editing.banner}
          placement={editing.placement}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/** ISO instant → the "YYYY-MM-DDTHH:mm" local string a datetime input wants. */
function toLocalInput(value: Date | null): string {
  if (!value) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` +
    `T${pad(value.getHours())}:${pad(value.getMinutes())}`
  );
}

function BannerDialog({
  banner,
  placement,
  onClose,
  onSaved,
}: {
  banner: AdminBanner | null;
  placement: BannerPlacement;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [imageUrl, setImageUrl] = React.useState(banner?.imageUrl ?? "");
  const [mobileImageUrl, setMobileImageUrl] = React.useState(
    banner?.mobileImageUrl ?? "",
  );
  const [alt, setAlt] = React.useState(banner?.alt ?? "");
  const [href, setHref] = React.useState(banner?.href ?? "");
  const [active, setActive] = React.useState(banner?.active ?? true);
  const [startsAt, setStartsAt] = React.useState(
    toLocalInput(banner?.startsAt ?? null),
  );
  const [endsAt, setEndsAt] = React.useState(toLocalInput(banner?.endsAt ?? null));
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState<"wide" | "mobile" | null>(
    null,
  );

  async function upload(file: File, which: "wide" | "mobile") {
    setUploading(which);
    try {
      const target = await presignBannerUpload(file.name, file.type);
      if (!target.ok) {
        toast.error(target.error);
        return;
      }
      const put = await fetch(target.uploadUrl, {
        method: "PUT",
        headers: target.headers,
        body: file,
      });
      if (!put.ok) {
        toast.error("The upload failed. Please try again.");
        return;
      }
      if (which === "wide") setImageUrl(target.publicUrl);
      else setMobileImageUrl(target.publicUrl);
    } catch {
      toast.error("Something went wrong during the upload.");
    } finally {
      setUploading(null);
    }
  }

  async function save() {
    if (saving) return;
    if (imageUrl.trim() === "") {
      toast.error("Upload the banner artwork first.");
      return;
    }
    setSaving(true);
    try {
      const res = await saveBannerAction(banner?.id ?? null, {
        placement,
        imageUrl: imageUrl.trim(),
        mobileImageUrl: mobileImageUrl.trim() === "" ? null : mobileImageUrl.trim(),
        alt: alt.trim(),
        href: href.trim() === "" ? null : href.trim(),
        sortOrder: banner?.sortOrder ?? 0,
        active,
        // datetime-local is local time; the server stores the instant.
        startsAt: startsAt === "" ? null : new Date(startsAt).toISOString(),
        endsAt: endsAt === "" ? null : new Date(endsAt).toISOString(),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(banner ? "Banner updated." : "Banner added.");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{banner ? "Edit banner" : "Add banner"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <ArtworkField
            label="Artwork (wide)"
            hint="Shown on tablets and desktop. A 3:1 strip works best."
            value={imageUrl}
            busy={uploading === "wide"}
            onPick={(file) => void upload(file, "wide")}
            onClear={() => setImageUrl("")}
          />

          <ArtworkField
            label="Artwork for phones (optional)"
            hint="A squarer crop, so a wide strip isn't a sliver on a phone. Falls back to the wide one."
            value={mobileImageUrl}
            busy={uploading === "mobile"}
            onPick={(file) => void upload(file, "mobile")}
            onClear={() => setMobileImageUrl("")}
          />

          <div className="space-y-1.5">
            <Label htmlFor="banner-alt">What it says</Label>
            <Input
              id="banner-alt"
              value={alt}
              maxLength={MAX_BANNER_ALT}
              placeholder="Diwali sale — 20% off all chargers"
              onChange={(e) => setAlt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Read aloud by screen readers, and shown if the image fails to
              load.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="banner-href">Where it goes (optional)</Label>
            <Input
              id="banner-href"
              value={href}
              placeholder="/c/chargers"
              onChange={(e) => setHref(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              A page on the shop like <code>/c/chargers</code>,{" "}
              <code>/b/boat</code> or <code>/search?q=cable</code> — or a full
              https:// address. Leave empty for a banner that isn&rsquo;t
              clickable.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="banner-starts">Starts (optional)</Label>
              <Input
                id="banner-starts"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="banner-ends">Ends (optional)</Label>
              <Input
                id="banner-ends"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Leave both empty to run until you turn it off. Scheduled changes
            reach the storefront within a few minutes.
          </p>

          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-input px-3 py-2.5">
            <span className="text-sm font-medium text-foreground">
              Show on the storefront
            </span>
            <Switch
              checked={active}
              onCheckedChange={setActive}
              aria-label="Show on the storefront"
            />
          </label>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void save()}
              disabled={saving || uploading !== null}
              aria-busy={saving || undefined}
            >
              {saving ? "Saving…" : banner ? "Save changes" : "Add banner"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ArtworkField({
  label,
  hint,
  value,
  busy,
  onPick,
  onClear,
}: {
  label: string;
  hint: string;
  value: string;
  busy: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        {value ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value}
              alt=""
              className="h-14 w-28 rounded-lg border border-border object-cover"
            />
            <Button type="button" variant="outline" size="sm" onClick={onClear}>
              Replace
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Uploading…
              </>
            ) : (
              <>
                <Upload className="size-4" aria-hidden />
                Upload
              </>
            )}
          </Button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPick(file);
            e.target.value = "";
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
