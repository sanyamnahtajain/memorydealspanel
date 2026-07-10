"use client";

import * as React from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FolderPlusIcon,
  ImageIcon,
  Loader2Icon,
  PencilIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { StatusChip, ConfirmSheet } from "@/components/common";

interface RowCategory {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  status: "ACTIVE" | "INACTIVE";
}

interface CategoryRowProps {
  category: RowCategory;
  isRoot?: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
  onToggleStatus: (id: string, next: "ACTIVE" | "INACTIVE") => void;
  onRename: (id: string, name: string) => Promise<boolean>;
  onEdit: () => void;
  onAddChild?: () => void;
  /** Delete this category (guarded server-side against non-empty categories). */
  onDelete: () => void | Promise<void>;
  /** Right-of-name summary (product / sub-category counts). */
  summary: React.ReactNode;
}

/**
 * A single category row: reorder controls, thumbnail, name (double-click or
 * pencil to rename inline), a product/sub-category summary, an active/inactive
 * toggle and an overflow of edit / add-sub actions. Used for both parent and
 * child rows; `isRoot` bumps the visual weight.
 */
export function CategoryRow({
  category,
  isRoot = false,
  canMoveUp,
  canMoveDown,
  onMove,
  onToggleStatus,
  onRename,
  onEdit,
  onAddChild,
  onDelete,
  summary,
}: CategoryRowProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(category.name);
  const [saving, setSaving] = React.useState(false);

  const startEditing = React.useCallback(() => {
    setDraft(category.name);
    setEditing(true);
  }, [category.name]);

  const commit = React.useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed.length < 2) {
      setEditing(false);
      setDraft(category.name);
      return;
    }
    if (trimmed === category.name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const ok = await onRename(category.id, trimmed);
    setSaving(false);
    if (ok) {
      setEditing(false);
    } else {
      setDraft(category.name);
    }
  }, [draft, category.name, category.id, onRename]);

  const cancel = React.useCallback(() => {
    setDraft(category.name);
    setEditing(false);
  }, [category.name]);

  const isActive = category.status === "ACTIVE";

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2.5",
        isRoot ? "gap-3 px-4 py-3" : "",
      )}
    >
      {/* Reorder controls (accessible up/down) */}
      <div className="flex shrink-0 flex-col">
        <button
          type="button"
          aria-label="Move up"
          disabled={!canMoveUp}
          onClick={() => onMove(-1)}
          className="inline-flex size-5 items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-30 active:scale-90"
        >
          <ChevronUpIcon className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Move down"
          disabled={!canMoveDown}
          onClick={() => onMove(1)}
          className="inline-flex size-5 items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-30 active:scale-90"
        >
          <ChevronDownIcon className="size-4" aria-hidden />
        </button>
      </div>

      {/* Thumbnail */}
      <div
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted",
          isRoot ? "size-10" : "size-8",
        )}
      >
        {category.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={category.image} alt="" className="size-full object-cover" />
        ) : (
          <ImageIcon
            className={cn("text-muted-foreground", isRoot ? "size-4" : "size-3.5")}
            aria-hidden
          />
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
              className={cn(
                "group flex w-fit max-w-full items-center gap-1.5 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                isRoot
                  ? "font-heading text-sm font-semibold"
                  : "text-sm font-medium",
              )}
            >
              <span className="truncate text-foreground">{category.name}</span>
              <PencilIcon
                className="size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground group-focus-visible:text-muted-foreground"
                aria-hidden
              />
            </button>
          </Tooltip>
        )}
        {!editing ? summary : null}
      </div>

      {/* Status toggle */}
      <button
        type="button"
        onClick={() =>
          onToggleStatus(category.id, isActive ? "INACTIVE" : "ACTIVE")
        }
        aria-label={
          isActive ? "Hide from storefront" : "Show on storefront"
        }
        aria-pressed={isActive}
        className="shrink-0 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95"
      >
        <StatusChip variant={isActive ? "active" : "inactive"} />
      </button>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-0.5">
        {onAddChild ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Add sub-category"
            onClick={onAddChild}
          >
            <FolderPlusIcon aria-hidden />
          </Button>
        ) : null}
        <Tooltip content="Edit category">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Edit category"
            onClick={onEdit}
          >
            <PencilIcon aria-hidden />
          </Button>
        </Tooltip>
        <ConfirmSheet
          title={`Delete "${category.name}"?`}
          description="This permanently removes the category. It's only allowed when no products or sub-categories still use it."
          confirmLabel="Delete"
          destructive
          onConfirm={onDelete}
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete category"
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
