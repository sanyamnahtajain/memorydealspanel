"use client";

/**
 * CurrencyCell — integer PAISE money cell.
 *
 * Money is stored as integer paise everywhere (see src/lib/money.ts). This
 * cell NEVER stores rupees or floats.
 *
 * Renderer: right-aligned tabular `formatPaise` output (₹499.50).
 * Editor: accepts human rupee input ("499.5", "₹1,299", "1,00,000") which is
 * parsed via `parseRupees` back to paise on commit. Empty draft commits `null`.
 * Unparseable non-empty drafts are validation errors — the draft is preserved
 * and surfaced, never silently dropped. Round-trip: paise -> rupees text ->
 * parseRupees -> same paise.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { formatPaise, parseRupees, isPaise } from "@/lib/money";
import type { CellEditorProps, CellRendererProps } from "./cell-props";
import { runValidate } from "./cell-props";
import { EditorShell, cellInputBase, commitKeyHandler } from "./editor-shell";

/** Format stored paise for display; blank for null/undefined. */
export function currencyToDisplay(value: unknown): string {
  if (value == null || value === "") return "";
  if (isPaise(value)) return formatPaise(value);
  // Defensive: a non-paise number still renders, but flags itself visually.
  const n = Number(value);
  return Number.isFinite(n) ? formatPaise(Math.max(0, Math.round(n))) : String(value);
}

/**
 * Seed the editor's draft from stored paise: paise -> plain rupees string
 * (no ₹, no grouping) so it round-trips cleanly through `parseRupees`.
 *   49950 -> "499.50" · 50000000 -> "500000" · null -> ""
 */
export function paiseToRupeeInput(value: unknown): string {
  if (value == null || value === "") return "";
  if (!isPaise(value)) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    value = Math.max(0, Math.round(n));
  }
  const paise = value as number;
  const rupees = Math.trunc(paise / 100);
  const remainder = paise % 100;
  return remainder === 0
    ? String(rupees)
    : `${rupees}.${String(remainder).padStart(2, "0")}`;
}

export function CurrencyRenderer({ value, column, className }: CellRendererProps) {
  const text = column.format ? column.format(value) : currencyToDisplay(value);
  return (
    <span
      data-slot="currency-cell"
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

export function CurrencyEditor({
  value,
  column,
  row,
  onCommit,
  onCancel,
  initialInput,
  className,
}: CellEditorProps) {
  const [draft, setDraft] = React.useState<string>(
    initialInput ?? paiseToRupeeInput(value),
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

  const trimmed = draft.trim();
  const isEmpty = trimmed === "";
  const parsedPaise = isEmpty ? null : parseRupees(draft);
  const parseError =
    !isEmpty && parsedPaise === null ? "Enter a valid ₹ amount" : null;
  const validateError = parseError
    ? null
    : runValidate(column, parsedPaise, row);
  const error = parseError ?? validateError;

  const commit = () => {
    if (error) return; // keep draft visible, surface error
    onCommit(parsedPaise);
  };

  return (
    <EditorShell error={error} className={className}>
      <div className="relative h-full w-full">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-2 grid place-items-center text-sm text-muted-foreground"
        >
          ₹
        </span>
        <input
          ref={inputRef}
          inputMode="decimal"
          data-invalid={error ? "" : undefined}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={commitKeyHandler({ onEnter: commit, onEscape: onCancel })}
          className={cn(cellInputBase, "pl-5 text-right font-tabular tabular-nums")}
        />
      </div>
    </EditorShell>
  );
}
