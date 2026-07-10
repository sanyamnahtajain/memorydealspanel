"use client";

import * as React from "react";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

interface TagEditorProps {
  value: string[];
  onChange: (tags: string[]) => void;
  /** Hard cap mirrored from schemas/product (max 20). */
  max?: number;
  id?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Chip-style tag editor. Type a tag and press Enter or comma to commit it;
 * Backspace on an empty field removes the last chip. Duplicates (case-
 * insensitive) and blanks are ignored. Purely controlled — the parent form
 * owns the array.
 */
export function TagEditor({
  value,
  onChange,
  max = 20,
  id,
  className,
  disabled,
}: TagEditorProps) {
  const [draft, setDraft] = React.useState("");

  const commit = React.useCallback(
    (raw: string) => {
      const tag = raw.trim();
      if (!tag) return;
      if (value.length >= max) return;
      const exists = value.some((t) => t.toLowerCase() === tag.toLowerCase());
      if (exists) {
        setDraft("");
        return;
      }
      onChange([...value, tag]);
      setDraft("");
    },
    [value, onChange, max],
  );

  const removeAt = React.useCallback(
    (index: number) => {
      onChange(value.filter((_, i) => i !== index));
    },
    [value, onChange],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(draft);
    } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
      removeAt(value.length - 1);
    }
  };

  const atCapacity = value.length >= max;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent p-1.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      {value.map((tag, index) => (
        <span
          key={`${tag}-${index}`}
          className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-secondary px-2 text-xs font-medium text-secondary-foreground"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={() => removeAt(index)}
            className="-mr-0.5 inline-flex size-4 items-center justify-center rounded text-muted-foreground transition-fast hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <XIcon className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      <Input
        id={id}
        value={draft}
        disabled={disabled || atCapacity}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => commit(draft)}
        placeholder={
          atCapacity ? `Max ${max} tags` : value.length ? "Add tag…" : "Add tags…"
        }
        className="h-6 flex-1 basis-24 border-0 bg-transparent px-1 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
      />
    </div>
  );
}
