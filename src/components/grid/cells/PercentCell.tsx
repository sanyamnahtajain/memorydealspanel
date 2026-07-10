"use client";

/**
 * PercentCell — a percentage value in the range 0–100.
 *
 * Renderer: right-aligned tabular "42%" / "42.5%".
 * Editor: numeric input with a trailing "%"; accepts "42" or "42%". Commits a
 * number. Values outside 0–100 or non-numeric drafts are validation errors —
 * the draft is preserved and surfaced. `column.validate` (if any) runs after
 * the built-in bounds check.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import type { CellEditorProps, CellRendererProps } from "./cell-props";
import { runValidate } from "./cell-props";
import { EditorShell, cellInputBase, commitKeyHandler } from "./editor-shell";

/** Lower/upper bounds for a percentage. */
export const PERCENT_MIN = 0;
export const PERCENT_MAX = 100;

/** Format a stored percent number for display (trailing %). */
export function percentToDisplay(value: unknown): string {
  if (value == null || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  // Trim trailing zeros: 42 -> "42%", 42.5 -> "42.5%".
  const rounded = Math.round(n * 100) / 100;
  return `${rounded}%`;
}

/** Strip a trailing % and parse; returns number or null (empty), ok flag. */
export function parsePercentDraft(
  raw: string,
): { value: number | null; ok: boolean } {
  const trimmed = raw.trim().replace(/%\s*$/, "").trim();
  if (trimmed === "") return { value: null, ok: true };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { value: null, ok: false };
  return { value: n, ok: true };
}

/** Built-in bounds check: returns an error message or null. */
export function percentBoundsError(value: number | null): string | null {
  if (value == null) return null;
  if (value < PERCENT_MIN || value > PERCENT_MAX) {
    return `Must be between ${PERCENT_MIN} and ${PERCENT_MAX}`;
  }
  return null;
}

export function PercentRenderer({ value, column, className }: CellRendererProps) {
  const text = column.format ? column.format(value) : percentToDisplay(value);
  return (
    <span
      data-slot="percent-cell"
      className={cn(
        "block truncate text-right font-tabular tabular-nums",
        text ? undefined : "text-muted-foreground",
        className,
      )}
      title={text || undefined}
    >
      {text || " "}
    </span>
  );
}

export function PercentEditor({
  value,
  column,
  row,
  onCommit,
  onCancel,
  initialInput,
  className,
}: CellEditorProps) {
  const [draft, setDraft] = React.useState<string>(
    initialInput ?? (value == null ? "" : String(value)),
  );
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (initialInput != null) {
      el.setSelectionRange(el.value.length, el.value.length);
    } else {
      el.select();
    }
  }, [initialInput]);

  const parsed = parsePercentDraft(draft);
  const parseError = parsed.ok ? null : "Enter a valid percentage";
  const boundsError = parsed.ok ? percentBoundsError(parsed.value) : null;
  const validateError =
    parsed.ok && !boundsError ? runValidate(column, parsed.value, row) : null;
  const error = parseError ?? boundsError ?? validateError;

  const commit = () => {
    if (error) return; // keep draft, surface error
    onCommit(parsed.value);
  };

  return (
    <EditorShell error={error} className={className}>
      <div className="relative h-full w-full">
        <input
          ref={inputRef}
          inputMode="decimal"
          data-invalid={error ? "" : undefined}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={commitKeyHandler({ onEnter: commit, onEscape: onCancel })}
          className={cn(cellInputBase, "pr-5 text-right font-tabular tabular-nums")}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-2 grid place-items-center text-sm text-muted-foreground"
        >
          %
        </span>
      </div>
    </EditorShell>
  );
}
