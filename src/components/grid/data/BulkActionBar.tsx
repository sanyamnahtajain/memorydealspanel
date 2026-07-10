"use client";

/**
 * BulkActionBar — presentational floating action bar shown while rows are
 * selected. Slides up from the bottom with motion, shows the selection count,
 * and renders injected action handlers. It holds NO business logic: the parent
 * wires each handler to the pure bulk ops in `./bulk.ts`.
 *
 * Respects reduced-motion via the shared motion primitives' convention.
 */

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  IndianRupee,
  Tag,
  CircleDot,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { springs } from "@/components/motion/tokens";

/** One action rendered in the bar. */
export interface BulkAction {
  /** Stable key for React lists. */
  key: string;
  /** Button label. */
  label: string;
  /** Optional leading icon. */
  icon?: LucideIcon;
  /** Click handler — parent wires this to a pure bulk op. */
  onClick: () => void;
  /** Visual emphasis; `destructive` for delete-style actions. */
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary";
  /** Disable the action (e.g. while a save is in flight). */
  disabled?: boolean;
}

export interface BulkActionBarProps {
  /** Number of currently selected rows. The bar hides when this is 0. */
  count: number;
  /** Actions to render, left-to-right. */
  actions: BulkAction[];
  /** Clear-selection handler for the trailing dismiss button. */
  onClear: () => void;
  /** Optional noun for the count label; defaults to "row". */
  noun?: string;
  className?: string;
}

/**
 * Convenience factory for the standard DealSheet actions. Purely builds the
 * `BulkAction[]` array from injected handlers — no state, no logic.
 */
export function standardBulkActions(handlers: {
  onAdjustPrice: () => void;
  onAddTag: () => void;
  onSetStatus: () => void;
  onDelete: () => void;
  disabled?: boolean;
}): BulkAction[] {
  const { disabled } = handlers;
  return [
    {
      key: "adjust-price",
      label: "Adjust price",
      icon: IndianRupee,
      onClick: handlers.onAdjustPrice,
      variant: "outline",
      disabled,
    },
    {
      key: "add-tag",
      label: "Add tag",
      icon: Tag,
      onClick: handlers.onAddTag,
      variant: "outline",
      disabled,
    },
    {
      key: "set-status",
      label: "Set status",
      icon: CircleDot,
      onClick: handlers.onSetStatus,
      variant: "outline",
      disabled,
    },
    {
      key: "delete",
      label: "Delete",
      icon: Trash2,
      onClick: handlers.onDelete,
      variant: "destructive",
      disabled,
    },
  ];
}

export function BulkActionBar({
  count,
  actions,
  onClear,
  noun = "row",
  className,
}: BulkActionBarProps) {
  const reduced = useReducedMotion();
  const open = count > 0;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          role="toolbar"
          aria-label="Bulk actions"
          className={cn(
            "pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4",
            className,
          )}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
          transition={springs.gentle}
        >
          <div
            className={cn(
              "pointer-events-auto flex max-w-full items-center gap-2 rounded-2xl border border-border",
              "bg-popover/95 px-3 py-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-popover/80",
            )}
          >
            <Badge variant="secondary" className="tabular-nums">
              {count} {noun}
              {count === 1 ? "" : "s"} selected
            </Badge>

            <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />

            <div className="flex items-center gap-1.5">
              {actions.map((action) => {
                const Icon = action.icon;
                return (
                  <Button
                    key={action.key}
                    type="button"
                    size="sm"
                    variant={action.variant ?? "outline"}
                    disabled={action.disabled}
                    onClick={action.onClick}
                  >
                    {Icon ? <Icon data-icon="inline-start" /> : null}
                    {action.label}
                  </Button>
                );
              })}
            </div>

            <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />

            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Clear selection"
              onClick={onClear}
            >
              <X />
            </Button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export default BulkActionBar;
