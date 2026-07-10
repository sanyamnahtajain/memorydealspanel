"use client";

/**
 * MultiTagCell — many choices from `column.options`, stored as `string[]`.
 *
 * Renderer: a wrapping row of colored token chips (with a "+N" overflow badge
 * when space is tight — the engine controls width, we just truncate the row).
 * Editor: token chips with remove buttons + an autocomplete input. Type to
 * filter remaining options; ↑/↓ + Enter adds the highlighted option; Backspace
 * on an empty query removes the last chip; Enter with no highlight commits;
 * Esc cancels. Commits the full `string[]` on blur/Enter. `column.validate`
 * runs against the draft array and is surfaced without dropping the draft.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import type { CellOption } from "@/components/grid/types";
import type { CellEditorProps, CellRendererProps } from "./cell-props";
import { runValidate } from "./cell-props";
import { EditorShell } from "./editor-shell";
import { OptionChip } from "./option-chip";

/** Coerce a stored value into a string[] of tag values. */
export function toTagArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value == null || value === "") return [];
  return [String(value)];
}

/** Resolve tag values to their options, synthesizing a plain chip for unknowns. */
function resolveTags(
  values: string[],
  options: CellOption[] | undefined,
): CellOption[] {
  return values.map((v) => {
    const found = options?.find((o) => o.value === v);
    return found ?? { value: v, label: v };
  });
}

export function MultiTagRenderer({ value, column, className }: CellRendererProps) {
  const tags = resolveTags(toTagArray(value), column.options);
  return (
    <span
      data-slot="multi-tag-cell"
      className={cn("flex min-w-0 items-center gap-1 overflow-hidden", className)}
    >
      {tags.length === 0 ? (
        <span className="text-sm text-muted-foreground">—</span>
      ) : (
        tags.map((opt) => <OptionChip key={opt.value} option={opt} />)
      )}
    </span>
  );
}

export function MultiTagEditor({
  value,
  column,
  row,
  onCommit,
  onCancel,
  initialInput,
  className,
}: CellEditorProps) {
  const options = React.useMemo(() => column.options ?? [], [column.options]);
  const [tags, setTags] = React.useState<string[]>(toTagArray(value));
  const [query, setQuery] = React.useState<string>(initialInput ?? "");
  const [rawHighlight, setHighlight] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const available = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter(
      (o) =>
        !tags.includes(o.value) &&
        (q === "" ||
          o.label.toLowerCase().includes(q) ||
          o.value.toLowerCase().includes(q)),
    );
  }, [options, tags, query]);

  // Clamp at render time so the highlight always tracks a visible option
  // without a setState-in-effect cascade.
  const highlight =
    available.length === 0
      ? -1
      : Math.min(Math.max(rawHighlight, 0), available.length - 1);

  const error = runValidate(column, tags, row);

  const addTag = (val: string) => {
    setTags((t) => (t.includes(val) ? t : [...t, val]));
    setQuery("");
    setHighlight(0);
  };

  const removeTag = (val: string) => {
    setTags((t) => t.filter((x) => x !== val));
  };

  const commit = () => {
    if (error) return; // preserve draft, surface error
    onCommit(tags);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => Math.min(h + 1, available.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const opt = available[highlight];
      if (opt) addTag(opt.value);
      else commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    } else if (event.key === "Backspace" && query === "" && tags.length > 0) {
      event.preventDefault();
      setTags((t) => t.slice(0, -1));
    }
  };

  const chosen = resolveTags(tags, options);

  return (
    <EditorShell error={error} className={className}>
      <div className="relative h-full w-full">
        <div className="flex h-full flex-wrap items-center gap-1 bg-background px-1.5 py-1 ring-2 ring-inset ring-ring">
          {chosen.map((opt) => (
            <OptionChip
              key={opt.value}
              option={opt}
              onRemove={() => removeTag(opt.value)}
            />
          ))}
          <input
            ref={inputRef}
            value={query}
            placeholder={tags.length === 0 ? "Add tags…" : ""}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            className="h-5 min-w-[60px] flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        {available.length > 0 ? (
          <ul
            role="listbox"
            className="absolute top-full left-0 z-30 mt-1 max-h-56 w-max min-w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-md"
          >
            {available.map((opt, i) => (
              <li key={opt.value} role="option" aria-selected={false}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    e.preventDefault(); // beat blur
                    addTag(opt.value);
                    inputRef.current?.focus();
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
                    i === highlight
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground",
                  )}
                >
                  <OptionChip option={opt} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </EditorShell>
  );
}
