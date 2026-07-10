"use client";

/**
 * TextCell — free-form string cell.
 *
 * Renderer: shows the value (via `column.format` when provided), truncated.
 * Editor: a full-bleed text input; commits the trimmed string on Enter/blur,
 * cancels on Esc, and surfaces `column.validate` errors while preserving the
 * draft.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import type { CellEditorProps, CellRendererProps } from "./cell-props";
import { runValidate } from "./cell-props";
import { EditorShell, cellInputBase, commitKeyHandler } from "./editor-shell";

/** Coerce any stored value into a display string. */
export function textToDisplay(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

export function TextRenderer({ value, column, className }: CellRendererProps) {
  const text = column.format ? column.format(value) : textToDisplay(value);
  return (
    <span
      data-slot="text-cell"
      className={cn("block truncate", text ? undefined : "text-muted-foreground", className)}
      title={text || undefined}
    >
      {text || " "}
    </span>
  );
}

export function TextEditor({
  value,
  column,
  row,
  onCommit,
  onCancel,
  initialInput,
  className,
}: CellEditorProps) {
  const [draft, setDraft] = React.useState<string>(
    initialInput ?? textToDisplay(value),
  );
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // If seeded from a keystroke, place caret at the end; otherwise select all
    // so a fresh edit can be typed straight over.
    if (initialInput != null) {
      el.setSelectionRange(el.value.length, el.value.length);
    } else {
      el.select();
    }
  }, [initialInput]);

  const error = runValidate(column, draft, row);

  const commit = () => {
    if (error) return; // keep draft on screen; do not drop input
    onCommit(draft);
  };

  return (
    <EditorShell error={error} className={className}>
      <input
        ref={inputRef}
        data-invalid={error ? "" : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={commitKeyHandler({ onEnter: commit, onEscape: onCancel })}
        className={cn(cellInputBase)}
      />
    </EditorShell>
  );
}
