"use client";

import * as React from "react";
import { CheckIcon, MinusIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface PermissionCheckboxProps {
  checked: boolean;
  /** Tri-state: when true, renders the "some selected" dash (group header). */
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  className?: string;
}

/**
 * Custom, token-styled checkbox for the permission matrix.
 *
 * A visually-hidden native `<input type="checkbox">` carries all accessibility
 * (focus, keyboard, screen-reader state) while the adjacent `<span>` paints the
 * themed box. No native default styling is shown. Supports an indeterminate
 * state for group "select all" headers, mirrored onto the real input so
 * assistive tech announces "mixed".
 */
export function PermissionCheckbox({
  checked,
  indeterminate = false,
  onChange,
  disabled = false,
  id,
  className,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: PermissionCheckboxProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  // `indeterminate` is a DOM-only property (not a React attribute).
  React.useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate && !checked;
    }
  }, [indeterminate, checked]);

  return (
    <span
      className={cn(
        "relative inline-flex size-4.5 shrink-0 items-center justify-center",
        className,
      )}
    >
      <input
        ref={inputRef}
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        onChange={(event) => onChange(event.target.checked)}
        className="peer absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden
        className={cn(
          "flex size-4.5 items-center justify-center rounded-[6px] border transition-colors",
          "border-input bg-transparent text-transparent",
          "peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 peer-focus-visible:border-ring",
          "peer-disabled:opacity-50",
          (checked || indeterminate) &&
            "border-primary bg-primary text-primary-foreground",
        )}
      >
        {checked ? (
          <CheckIcon className="size-3" strokeWidth={3} />
        ) : indeterminate ? (
          <MinusIcon className="size-3" strokeWidth={3} />
        ) : null}
      </span>
    </span>
  );
}
