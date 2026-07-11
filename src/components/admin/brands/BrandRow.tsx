"use client";

import * as React from "react";
import {
  CheckIcon,
  ImageIcon,
  Loader2Icon,
  PencilIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { StatusChip, ConfirmSheet } from "@/components/common";

interface RowBrand {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  status: "ACTIVE" | "INACTIVE";
  productCount: number;
}

interface BrandRowProps {
  brand: RowBrand;
  onToggleStatus: (id: string, next: "ACTIVE" | "INACTIVE") => void;
  onRename: (id: string, name: string) => Promise<boolean>;
  onEdit: () => void;
  /** Delete this brand (guarded server-side against brands still in use). */
  onDelete: () => void | Promise<void>;
}

/**
 * A single brand row: logo thumbnail, name (double-click or pencil to rename
 * inline), a product-count summary, an active/inactive toggle and edit/delete
 * actions. Deletion is guarded server-side — a brand referenced by any product
 * cannot be removed.
 */
export function BrandRow({
  brand,
  onToggleStatus,
  onRename,
  onEdit,
  onDelete,
}: BrandRowProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(brand.name);
  const [saving, setSaving] = React.useState(false);

  const startEditing = React.useCallback(() => {
    setDraft(brand.name);
    setEditing(true);
  }, [brand.name]);

  const commit = React.useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed.length < 2) {
      setEditing(false);
      setDraft(brand.name);
      return;
    }
    if (trimmed === brand.name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const ok = await onRename(brand.id, trimmed);
    setSaving(false);
    if (ok) {
      setEditing(false);
    } else {
      setDraft(brand.name);
    }
  }, [draft, brand.name, brand.id, onRename]);

  const cancel = React.useCallback(() => {
    setDraft(brand.name);
    setEditing(false);
  }, [brand.name]);

  const isActive = brand.status === "ACTIVE";

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {/* Logo */}
      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
        {brand.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logo} alt="" className="size-full object-contain" />
        ) : (
          <ImageIcon className="size-4 text-muted-foreground" aria-hidden />
        )}
      </div>

      {/* Name + summary */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {editing ? (
          <div className="flex items-center gap-1.5">
            <Input
              value={draft}
              autoFocus
              maxLength={80}
              disabled={saving}
              className="h-7"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commit();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  cancel();
                }
              }}
              onBlur={() => void commit()}
            />
            <button
              type="button"
              aria-label="Save name"
              disabled={saving}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void commit()}
              className="inline-flex size-6 items-center justify-center rounded text-success outline-none transition-colors hover:bg-success/10 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
            >
              {saving ? (
                <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <CheckIcon className="size-3.5" aria-hidden />
              )}
            </button>
            <button
              type="button"
              aria-label="Cancel rename"
              disabled={saving}
              onMouseDown={(event) => event.preventDefault()}
              onClick={cancel}
              className="inline-flex size-6 items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
            >
              <XIcon className="size-3.5" aria-hidden />
            </button>
          </div>
        ) : (
          <Tooltip content="Double-click to rename">
            <button
              type="button"
              onDoubleClick={startEditing}
              className="group flex w-fit max-w-full items-center gap-1.5 rounded text-left font-heading text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="truncate text-foreground">{brand.name}</span>
              <PencilIcon
                className="size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground group-focus-visible:text-muted-foreground"
                aria-hidden
              />
            </button>
          </Tooltip>
        )}
        {!editing ? (
          <span className="text-xs text-muted-foreground">
            {brand.productCount}{" "}
            {brand.productCount === 1 ? "product" : "products"}
          </span>
        ) : null}
      </div>

      {/* Status toggle */}
      <button
        type="button"
        onClick={() =>
          onToggleStatus(brand.id, isActive ? "INACTIVE" : "ACTIVE")
        }
        aria-label={isActive ? "Hide from storefront" : "Show on storefront"}
        aria-pressed={isActive}
        className="shrink-0 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95"
      >
        <StatusChip variant={isActive ? "active" : "inactive"} />
      </button>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip content="Edit brand">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Edit brand"
            onClick={onEdit}
          >
            <PencilIcon aria-hidden />
          </Button>
        </Tooltip>
        <ConfirmSheet
          title={`Delete "${brand.name}"?`}
          description="This permanently removes the brand. It's only allowed when no products still reference it — reassign those first."
          confirmLabel="Delete"
          destructive
          onConfirm={onDelete}
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete brand"
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2Icon aria-hidden />
            </Button>
          }
        />
      </div>
    </div>
  );
}
