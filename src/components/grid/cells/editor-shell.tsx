"use client";

/**
 * Shared editor chrome: a positioned wrapper that draws the focus ring and,
 * when the current draft is invalid, a red corner triangle with an accessible
 * tooltip carrying the validation message. Every Editor wraps its input in
 * this so error affordances look and behave identically across cell types.
 */

import * as React from "react";
import { cn } from "@/lib/utils";

interface EditorShellProps {
  /** The live validation error, or null when the draft is valid. */
  error: string | null;
  /** The editing surface (input, dropdown trigger, switch, …). */
  children: React.ReactNode;
  /** Extra classes for the outer wrapper (alignment, width). */
  className?: string;
}

/**
 * Wraps an editor input. When `error` is set it renders a small destructive
 * corner marker in the top-right and exposes the message via `title` +
 * `aria-describedby` so both pointer hover and screen readers surface it, all
 * while the draft input underneath stays untouched (input is never dropped).
 */
export function EditorShell({ error, children, className }: EditorShellProps) {
  const id = React.useId();
  const describedBy = error ? `${id}-err` : undefined;

  return (
    <div
      data-slot="cell-editor"
      data-invalid={error ? "" : undefined}
      className={cn("relative h-full w-full", className)}
    >
      {children}
      {error ? (
        <>
          {/* Red corner triangle — purely decorative; message lives below. */}
          <span
            aria-hidden
            title={error}
            className="pointer-events-auto absolute top-0 right-0 z-20 size-0 border-t-[7px] border-l-[7px] border-t-destructive border-l-transparent"
          />
          {/* Tooltip bubble, shown on hover/focus-within of the cell. */}
          <span
            id={describedBy}
            role="tooltip"
            className={cn(
              "pointer-events-none absolute top-full right-0 z-30 mt-1 max-w-[240px]",
              "rounded-md border border-destructive/30 bg-destructive px-2 py-1",
              "text-xs font-medium text-destructive-foreground shadow-md",
              "whitespace-normal opacity-0 transition-opacity duration-150",
              "group-focus-within/cell:opacity-100 [[data-slot=cell-editor]:hover_&]:opacity-100",
            )}
          >
            {error}
          </span>
        </>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Shared keyboard helper                                                    */
/* -------------------------------------------------------------------------- */

interface CommitKeyHandlers {
  /** Called on Enter when the draft is committable. */
  onEnter: () => void;
  /** Called on Escape. */
  onEscape: () => void;
}

/**
 * Builds an onKeyDown handler implementing the universal commit/cancel
 * contract: Enter commits, Escape cancels. Both stop propagation so the grid's
 * global navigation doesn't also act on the key.
 */
export function commitKeyHandler({ onEnter, onEscape }: CommitKeyHandlers) {
  return (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      onEnter();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
    }
  };
}

/* -------------------------------------------------------------------------- */
/*  Shared input styling                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Base classes for a full-bleed cell input: fills the cell, no chrome of its
 * own (the cell border/selection ring is drawn by the grid), tabular numerals
 * optional via caller.
 */
export const cellInputBase =
  "h-full w-full bg-background px-2 text-sm text-foreground outline-none " +
  "ring-2 ring-inset ring-ring/60 focus-visible:ring-ring " +
  "data-[invalid]:ring-destructive";
