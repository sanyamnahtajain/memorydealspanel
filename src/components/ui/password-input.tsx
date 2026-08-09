"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * PasswordInput — the standard password field: an `Input` with a show/hide
 * toggle so the user can verify what they typed. Use this for EVERY password
 * field (login, account creation, password change) instead of a bare
 * `<Input type="password">`.
 *
 * Details that matter:
 *  - The toggle is `tabIndex={-1}`: Tab goes field → submit, matching every
 *    familiar login form; the eye is a pointer affordance, still reachable by
 *    screen readers via its explicit label.
 *  - `aria-pressed` + a live label ("Show password" / "Hide password") keep
 *    the state accessible.
 *  - Visibility resets to hidden whenever the field is disabled (a pending
 *    submit must not flash the plaintext).
 *  - The input keeps its own `autoComplete` from the caller — the toggle does
 *    not interfere with password managers.
 */
export function PasswordInput({
  className,
  disabled,
  ...props
}: Omit<React.ComponentProps<"input">, "type">) {
  const [visible, setVisible] = React.useState(false);

  // Never leave the plaintext showing on a field the user can't interact with.
  // Render-time adjustment (the codebase's seen-prop pattern) — an effect here
  // would set state synchronously and cascade a re-render.
  const [wasDisabled, setWasDisabled] = React.useState(disabled ?? false);
  if ((disabled ?? false) !== wasDisabled) {
    setWasDisabled(disabled ?? false);
    if (disabled) setVisible(false);
  }

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        disabled={disabled}
        className={cn("pr-9", className)}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        disabled={disabled}
        onClick={() => setVisible((v) => !v)}
        className={cn(
          "absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-lg",
          "text-muted-foreground transition-colors hover:text-foreground",
          "outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          "disabled:pointer-events-none disabled:opacity-40",
        )}
      >
        {visible ? (
          <EyeOff aria-hidden className="size-4" />
        ) : (
          <Eye aria-hidden className="size-4" />
        )}
      </button>
    </div>
  );
}
