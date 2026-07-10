"use client";

/**
 * NumberCell — plain numeric value (not money; see CurrencyCell for paise).
 *
 * Renderer: right-aligned, tabular en-IN grouping.
 * Editor: numeric input; parses the draft to a number on commit. Empty draft
 * commits `null`. Non-numeric drafts are treated as validation errors so the
 * draft is preserved and surfaced rather than silently dropped.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import type { CellEditorProps, CellRendererProps } from "./cell-props";
import { runValidate } from "./cell-props";
import { EditorShell, cellInputBase, commitKeyHandler } from "./editor-shell";

const groupFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 4,
});

/** Format a stored numeric value for display. */
export function numberToDisplay(value: unknown): string {
  if (value == null || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? groupFormatter.format(n) : String(value);
}

/**
 * Parse a raw draft string into a number or null (empty). Returns `NaN`
 * sentinel via the second tuple slot when the input is present but unparseable.
 */
export function parseNumberDraft(
  raw: string,
): { value: number | null; ok: boolean } {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null, ok: true };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { value: null, ok: false };
  return { value: n, ok: true };
}

export function NumberRenderer({ value, column, className }: CellRendererProps) {
  const text = column.format ? column.format(value) : numberToDisplay(value);
  return (
    <span
      data-slot="number-cell"
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

export function NumberEditor({
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

  const parsed = parseNumberDraft(draft);
  const parseError = parsed.ok ? null : "Enter a valid number";
  const validateError = parsed.ok ? runValidate(column, parsed.value, row) : null;
  const error = parseError ?? validateError;

  const commit = () => {
    if (error) return; // preserve draft, surface error
    onCommit(parsed.value);
  };

  return (
    <EditorShell error={error} className={className}>
      <input
        ref={inputRef}
        inputMode="decimal"
        data-invalid={error ? "" : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={commitKeyHandler({ onEnter: commit, onEscape: onCancel })}
        className={cn(cellInputBase, "text-right font-tabular tabular-nums")}
      />
    </EditorShell>
  );
}
