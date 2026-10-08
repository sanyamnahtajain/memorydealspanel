"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Clapperboard,
  ExternalLink,
  Package,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { StatusChip } from "@/components/common/StatusChip";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmSheet } from "@/components/common/ConfirmSheet";
import { MAX_REELS } from "@/lib/reels";
import {
  deleteReelAction,
  reorderReelsAction,
  saveReelAction,
} from "@/server/actions/reels";
import type { AdminReel } from "@/server/services/reels";
import { ReelDialog } from "./ReelDialog";
import { formatDuration } from "./upload";

/**
 * Reel management: a grid of 9:16 cards in storefront order.
 *
 * Every card says whether the storefront is showing it, and WHY not when it
 * isn't — "Turned off" is the admin's doing; "Product hidden" means the reel
 * still plays but has lost its Shop button because the product was
 * deactivated or deleted.
 */

export function ReelManager({ reels }: { reels: AdminReel[] }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<
    { reel: AdminReel | null } | null
  >(null);
  const [pendingDelete, setPendingDelete] = React.useState<AdminReel | null>(
    null,
  );
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [reordering, setReordering] = React.useState(false);
  const busy = busyId !== null || reordering;

  const nextSortOrder = reels.reduce((max, r) => Math.max(max, r.sortOrder), -1) + 1;
  const atCap = reels.length >= MAX_REELS;

  async function move(index: number, delta: number) {
    const next = [...reels];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setReordering(true);
    try {
      const res = await reorderReelsAction(next.map((r) => r.id));
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    } finally {
      setReordering(false);
    }
  }

  async function toggleActive(reel: AdminReel, active: boolean) {
    setBusyId(reel.id);
    try {
      const res = await saveReelAction(
        {
          videoUrl: reel.videoUrl,
          posterUrl: reel.posterUrl,
          caption: reel.caption,
          instagramUrl: reel.instagramUrl,
          productId: reel.productId,
          durationSec: reel.durationSec,
          sortOrder: reel.sortOrder,
          active,
        },
        reel.id,
      );
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(active ? "Reel is live." : "Reel hidden.");
        router.refresh();
      }
    } finally {
      setBusyId(null);
    }
  }

  async function remove(reel: AdminReel) {
    setBusyId(reel.id);
    try {
      const res = await deleteReelAction(reel.id);
      if (!res.ok) {
        toast.error(res.error);
        throw new Error(res.error);
      }
      toast.success("Reel removed.");
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground tabular-nums">
          {reels.length === 0
            ? "No reels yet"
            : `${reels.length} of ${MAX_REELS} reels · ${reels.filter((r) => r.active).length} live`}
        </p>
        <Button
          type="button"
          size="sm"
          disabled={busy || atCap}
          title={atCap ? `You already have ${MAX_REELS} reels.` : undefined}
          onClick={() => setEditing({ reel: null })}
        >
          <Plus className="size-4" aria-hidden />
          Add reel
        </Button>
      </div>

      {reels.length === 0 ? (
        <EmptyState
          illustration={
            <Clapperboard className="size-10 text-muted-foreground" aria-hidden />
          }
          title="No reels yet"
          description="Reels are the short vertical clips you post on Instagram, hosted here so shoppers can watch them without leaving the shop. Once you add one it appears in the rail on the home page and in the full-screen feed at /reels."
          action={
            <Button type="button" onClick={() => setEditing({ reel: null })}>
              <Plus className="size-4" aria-hidden />
              Add your first reel
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {reels.map((reel, index) => {
            const productHidden = !!reel.productId && !reel.product;
            const rowBusy = busyId === reel.id || reordering;
            return (
              <li
                key={reel.id}
                className="group/reel flex flex-col overflow-hidden rounded-xl border border-border bg-card"
                aria-busy={rowBusy || undefined}
              >
                <ReelThumb reel={reel} />

                <div className="flex flex-1 flex-col gap-2 p-3">
                  <p className="line-clamp-2 text-sm font-medium text-foreground">
                    {reel.caption}
                  </p>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusChip
                      variant={reel.active ? "active" : "inactive"}
                      label={reel.active ? "Live" : "Turned off"}
                    />
                    {reel.instagramUrl ? (
                      <a
                        href={reel.instagramUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        aria-label="Open on Instagram"
                        className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <ExternalLink className="size-3.5" aria-hidden />
                      </a>
                    ) : null}
                  </div>

                  <ProductChip reel={reel} hidden={productHidden} />

                  <div className="mt-auto flex items-center justify-between gap-1 pt-1">
                    <Switch
                      checked={reel.active}
                      disabled={rowBusy}
                      onCheckedChange={(checked) => void toggleActive(reel, checked)}
                      aria-label={reel.active ? "Hide this reel" : "Show this reel"}
                    />
                    <div className="flex items-center">
                      <IconButton
                        label="Move earlier"
                        disabled={busy || index === 0}
                        onClick={() => void move(index, -1)}
                      >
                        <ArrowUp className="size-4" aria-hidden />
                      </IconButton>
                      <IconButton
                        label="Move later"
                        disabled={busy || index === reels.length - 1}
                        onClick={() => void move(index, 1)}
                      >
                        <ArrowDown className="size-4" aria-hidden />
                      </IconButton>
                      <IconButton
                        label="Edit reel"
                        disabled={busy}
                        onClick={() => setEditing({ reel })}
                      >
                        <Pencil className="size-4" aria-hidden />
                      </IconButton>
                      <IconButton
                        label="Remove reel"
                        disabled={busy}
                        destructive
                        onClick={() => setPendingDelete(reel)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </IconButton>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing ? (
        <ReelDialog
          key={editing.reel?.id ?? "new"}
          reel={editing.reel}
          nextSortOrder={nextSortOrder}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}

      <ConfirmSheet
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Remove this reel?"
        description="It disappears from the home page and the /reels feed within a moment. The clip itself stays in storage."
        destructive
        confirmLabel="Remove"
        onConfirm={async () => {
          if (pendingDelete) await remove(pendingDelete);
        }}
      />
    </div>
  );
}

/** 9:16 thumbnail — the poster when there is one, else the clip's first frame. */
function ReelThumb({ reel }: { reel: AdminReel }) {
  const duration = formatDuration(reel.durationSec);
  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden bg-foreground">
      {reel.posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={reel.posterUrl}
          alt=""
          loading="lazy"
          className="size-full object-cover"
        />
      ) : (
        <video
          src={`${reel.videoUrl}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          className="size-full object-cover"
          aria-hidden
          tabIndex={-1}
        />
      )}
      {duration ? (
        <span className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white tabular-nums">
          {duration}
        </span>
      ) : null}
      {!reel.active ? (
        <div className="absolute inset-0 bg-background/50 backdrop-grayscale" aria-hidden />
      ) : null}
    </div>
  );
}

function ProductChip({ reel, hidden }: { reel: AdminReel; hidden: boolean }) {
  if (hidden) {
    return (
      <p className="inline-flex items-center gap-1.5 rounded-full border border-warning/35 bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning-foreground">
        <Package className="size-3" aria-hidden />
        Product hidden — no Shop button
      </p>
    );
  }
  if (!reel.product) {
    return (
      <p className="text-xs text-muted-foreground">No product linked</p>
    );
  }
  return (
    <p className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
      {reel.product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={reel.product.imageUrl}
          alt=""
          className="size-4 shrink-0 rounded-sm object-contain"
        />
      ) : (
        <Package className="size-3 shrink-0" aria-hidden />
      )}
      <span className="truncate">{reel.product.name}</span>
    </p>
  );
}

function IconButton({
  label,
  disabled,
  destructive,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  destructive?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={
        destructive
          ? "rounded-md p-1.5 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-30"
          : "rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
      }
    >
      {children}
    </button>
  );
}
