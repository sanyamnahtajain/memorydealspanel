"use client";

/**
 * ToggleCell — a boolean, rendered as an animated switch.
 *
 * Because a toggle has exactly two states, its Renderer is interactive-looking
 * but read-only, and the Editor is the live switch. The switch animates its
 * thumb with the shared `snappy` spring (respecting reduced-motion). Clicking /
 * Space / Enter flips and commits immediately; Esc cancels. `column.validate`
 * (rare for booleans) is surfaced without dropping the draft.
 */

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { springs } from "@/components/motion/tokens";
import type { CellEditorProps, CellRendererProps } from "./cell-props";
import { runValidate } from "./cell-props";
import { EditorShell } from "./editor-shell";

/** Coerce any stored value to a boolean. */
export function toBool(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

interface SwitchProps {
  checked: boolean;
  disabled?: boolean;
  onToggle?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  focusable?: boolean;
  refCb?: (el: HTMLButtonElement | null) => void;
}

/** The visual switch, shared by Renderer (disabled) and Editor (live). */
function Switch({
  checked,
  disabled,
  onToggle,
  onKeyDown,
  focusable,
  refCb,
}: SwitchProps) {
  const reduced = useReducedMotion();
  return (
    <button
      type="button"
      ref={refCb}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      tabIndex={focusable ? 0 : -1}
      onClick={onToggle}
      onKeyDown={onKeyDown}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
        checked
          ? "border-transparent bg-primary"
          : "border-transparent bg-input dark:bg-input/60",
        disabled ? "cursor-default opacity-100" : "cursor-pointer",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
      )}
    >
      <motion.span
        layout={!reduced}
        aria-hidden
        className="pointer-events-none block size-4 rounded-full bg-background shadow-sm"
        animate={{ x: checked ? 18 : 2 }}
        transition={reduced ? { duration: 0 } : springs.snappy}
      />
    </button>
  );
}

export function ToggleRenderer({ value, className }: CellRendererProps) {
  const checked = toBool(value);
  return (
    <span
      data-slot="toggle-cell"
      className={cn("flex h-full items-center", className)}
    >
      <Switch checked={checked} disabled focusable={false} />
    </span>
  );
}

export function ToggleEditor({
  value,
  column,
  row,
  onCommit,
  onCancel,
  className,
}: CellEditorProps) {
  const [checked, setChecked] = React.useState<boolean>(toBool(value));
  const btnRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    btnRef.current?.focus();
  }, []);

  const error = runValidate(column, checked, row);

  const flip = () => {
    const next = !checked;
    setChecked(next);
    const err = runValidate(column, next, row);
    if (err) return; // preserve draft, surface error
    onCommit(next);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      flip();
    }
  };

  return (
    <EditorShell error={error} className={className}>
      <span className="flex h-full items-center bg-background px-2 ring-2 ring-inset ring-ring">
        <Switch
          refCb={(el) => (btnRef.current = el)}
          checked={checked}
          focusable
          onToggle={flip}
          onKeyDown={onKeyDown}
        />
      </span>
    </EditorShell>
  );
}
