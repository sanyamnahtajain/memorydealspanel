"use client";

/**
 * SelectCell — single choice from `column.options`, rendered as a colored chip.
 *
 * Renderer: the chosen option's colored chip (or muted placeholder).
 * Editor: a searchable dropdown. Type to filter options; ↑/↓ to move the
 * highlight; Enter to pick the highlighted option (commits); Esc to cancel;
 * blur commits the highlighted/current selection. Picking commits immediately.
 * `column.validate` errors are surfaced with a red corner while preserving the
 * current draft selection.
 */

import * as React from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CellOption } from "@/components/grid/types";
import type { CellEditorProps, CellRendererProps } from "./cell-props";
import { runValidate } from "./cell-props";
import { EditorShell } from "./editor-shell";
import { OptionChip, chipStyle, findOption } from "./option-chip";

export function SelectRenderer({ value, column, className }: CellRendererProps) {
  const option = findOption(column.options, value);
  return (
    <span data-slot="select-cell" className={cn("flex min-w-0 items-center", className)}>
      {option ? (
        <OptionChip option={option} />
      ) : (
        <span className="truncate text-sm text-muted-foreground">
          {value == null || value === "" ? "—" : String(value)}
        </span>
      )}
    </span>
  );
}

export function SelectEditor({
  value,
  column,
  row,
  onCommit,
  onCancel,
  initialInput,
  className,
}: CellEditorProps) {
  const options = React.useMemo(() => column.options ?? [], [column.options]);
  const [query, setQuery] = React.useState<string>(initialInput ?? "");
  const [selected, setSelected] = React.useState<string | null>(
    value == null ? null : String(value),
  );
  const inputRef = React.useRef<HTMLInputElement>(null);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  // Highlight is stored raw and clamped at render time so it always points at
  // a visible option even as the filter narrows (no setState-in-effect churn).
  const [rawHighlight, setHighlight] = React.useState(0);
  const highlight =
    filtered.length === 0
      ? -1
      : Math.min(Math.max(rawHighlight, 0), filtered.length - 1);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const error = runValidate(column, selected, row);

  const pick = (opt: CellOption) => {
    setSelected(opt.value);
    const err = runValidate(column, opt.value, row);
    if (err) return; // keep dropdown open, surface error; draft preserved
    onCommit(opt.value);
  };

  const commitCurrent = () => {
    if (error) return;
    onCommit(selected);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const opt = filtered[highlight];
      if (opt) pick(opt);
      else commitCurrent();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  return (
    <EditorShell error={error} className={className}>
      <div className="relative h-full w-full">
        <div className="flex h-full items-center gap-1 bg-background pr-6 ring-2 ring-inset ring-ring">
          <input
            ref={inputRef}
            value={query}
            placeholder={
              selected
                ? findOption(options, selected)?.label ?? String(selected)
                : "Search…"
            }
            onChange={(e) => setQuery(e.target.value)}
            onBlur={commitCurrent}
            onKeyDown={onKeyDown}
            className="h-full w-full bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <ChevronDownIcon className="pointer-events-none absolute right-1.5 size-4 text-muted-foreground" />
        </div>
        <ul
          role="listbox"
          className="absolute top-full left-0 z-30 mt-1 max-h-56 w-max min-w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-md"
        >
          {filtered.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">No matches</li>
          ) : (
            filtered.map((opt, i) => {
              const isSel = opt.value === selected;
              const isHi = i === highlight;
              const { className: colorClass, style } = chipStyle(opt.color);
              return (
                <li key={opt.value} role="option" aria-selected={isSel}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(i)}
                    onMouseDown={(e) => {
                      e.preventDefault(); // beat the input blur
                      pick(opt);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
                      isHi ? "bg-accent text-accent-foreground" : "text-foreground",
                    )}
                  >
                    <span
                      style={style}
                      className={cn(
                        "inline-flex size-2.5 shrink-0 rounded-full border",
                        colorClass,
                      )}
                    />
                    <span className="flex-1 truncate">{opt.label}</span>
                    {isSel ? <CheckIcon className="size-3.5 shrink-0" /> : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </EditorShell>
  );
}
