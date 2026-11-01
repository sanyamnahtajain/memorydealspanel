"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpToLine, ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { reorderBrandsAction } from "@/server/actions/brands";
import type { BrandListItem } from "./BrandManager";

/**
 * "Arrange" mode of the admin brand list: the order brands appear in on the
 * storefront (home "Shop by brand" and the brands page), top first. Moves are
 * local until "Save order", which writes the whole order in one action, so a
 * half-arranged list never reaches shoppers.
 */
export function BrandArrangeList({
  brands,
  onDone,
}: {
  brands: BrandListItem[];
  /** Leave arrange mode; `saved` carries the new order when it was saved. */
  onDone: (saved: BrandListItem[] | null) => void;
}) {
  const [order, setOrder] = React.useState(brands);
  const [saving, setSaving] = React.useState(false);
  const dirty = order.some((b, i) => b.id !== brands[i]?.id);

  function move(index: number, to: number) {
    if (to < 0 || to >= order.length || to === index) return;
    setOrder((prev) => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await reorderBrandsAction({ ids: order.map((b) => b.id) });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Brand order saved — the shop shows it now.");
      onDone(order.map((b, i) => ({ ...b, sortOrder: i })));
    } catch {
      toast.error("Couldn't save the order. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3.5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-foreground">
          <span className="font-semibold">Arrange brands.</span>{" "}
          <span className="text-muted-foreground">
            Top shows first in “Shop by brand” on the home page and on the brands page.
          </span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={() => onDone(null)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!dirty || saving}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Save order
          </Button>
        </div>
      </div>

      <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {order.map((brand, index) => (
          <li
            key={brand.id}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5",
              brand.status === "INACTIVE" && "opacity-60",
            )}
          >
            <span className="w-6 shrink-0 text-right font-tabular text-sm font-semibold text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
              {brand.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={brand.logo} alt="" className="size-full object-contain" />
              ) : (
                <ImageIcon className="size-4 text-muted-foreground" aria-hidden />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{brand.name}</span>
              <span className="block text-xs text-muted-foreground">
                {brand.status === "INACTIVE"
                  ? "Hidden from the shop"
                  : `${brand.productCount} product${brand.productCount === 1 ? "" : "s"}`}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${brand.name} to the top`}
                title="Move to top"
                disabled={index === 0 || saving}
                onClick={() => move(index, 0)}
              >
                <ArrowUpToLine aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${brand.name} up`}
                disabled={index === 0 || saving}
                onClick={() => move(index, index - 1)}
              >
                <ArrowUp aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${brand.name} down`}
                disabled={index === order.length - 1 || saving}
                onClick={() => move(index, index + 1)}
              >
                <ArrowDown aria-hidden />
              </Button>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
