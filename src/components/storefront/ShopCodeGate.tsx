"use client";

import * as React from "react";
import { CheckIcon, Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { enterShopCodeAction } from "@/server/actions/entry-gate";
import { cn } from "@/lib/utils";

/**
 * ShopCodeGate — the customer-facing front door of the entry gate (see
 * src/lib/entry-gate.ts for what the gate is and is not). Shown in place of
 * the request-access form when this device has not yet entered the shop code.
 *
 * The input is deliberately a VISIBLE text field, not a password: the code is
 * shared shop-to-customer, not a secret the typist owns, and masking it only
 * causes typos. The server compares case-insensitively, so autoCapitalize
 * merely matches what people were shown on WhatsApp.
 *
 * On success the server remembers this device (cookie); we show a brief tick
 * (~400ms) and then call `onPassed` so the parent can reveal the real form
 * without the transition jumping.
 */

/** Key-meets-lock illustration in the house minimal-SVG style. */
function ShopCodeIllustration(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 120 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...props}
    >
      {/* ground */}
      <path
        d="M18 84h84"
        className="stroke-border"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="1 7"
      />
      {/* shackle, swung open */}
      <path
        d="M40 42V30a15 15 0 0 1 28-7"
        className="stroke-muted-foreground"
        strokeWidth="4"
        strokeLinecap="round"
      />
      {/* lock body */}
      <rect
        x="30"
        y="42"
        width="44"
        height="32"
        rx="6"
        className="fill-muted stroke-muted-foreground"
        strokeWidth="2"
      />
      {/* keyhole */}
      <circle cx="52" cy="55" r="4" className="fill-primary" />
      <path
        d="M52 58v8"
        className="stroke-primary"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* key floating in */}
      <circle
        cx="95"
        cy="52"
        r="6"
        className="fill-card stroke-primary"
        strokeWidth="2"
      />
      <path
        d="M90 56 82 64M84 62l3 3M87 59l3 3"
        className="stroke-primary"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* hint sparkles */}
      <path
        d="M22 26v6M19 29h6M98 24l4 4M102 24l-4 4"
        className="stroke-primary/60"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="34" cy="16" r="2" className="fill-primary/60" />
    </svg>
  );
}

type Phase = "idle" | "submitting" | "success";

export interface ShopCodeGateProps {
  /** Called after a correct code (and the brief success tick). */
  onPassed: () => void;
  /**
   * Hide the built-in title + explanation — for hosts (the bottom sheet)
   * whose own header already carries that copy. The illustration stays.
   */
  showHeading?: boolean;
  className?: string;
}

export function ShopCodeGate({
  onPassed,
  showHeading = true,
  className,
}: ShopCodeGateProps) {
  const [code, setCode] = React.useState("");
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [error, setError] = React.useState<string | null>(null);

  // Latest callback without re-arming the success timer.
  const onPassedRef = React.useRef(onPassed);
  React.useEffect(() => {
    onPassedRef.current = onPassed;
  }, [onPassed]);

  // Clear the pending success timer if we unmount before it fires.
  const timerRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const attempt = code.trim();
      if (!attempt) {
        setError("Enter the shop code.");
        return;
      }
      setError(null);
      setPhase("submitting");
      try {
        const result = await enterShopCodeAction({ code: attempt });
        if (result.ok) {
          // Brief tick so the reveal of the form doesn't jump.
          setPhase("success");
          timerRef.current = window.setTimeout(() => {
            onPassedRef.current();
          }, 400);
        } else {
          setPhase("idle");
          // Server copy is customer-ready (wrong code / too many tries).
          setError(result.error);
        }
      } catch {
        setPhase("idle");
        setError("Something went wrong. Please try again.");
      }
    },
    [code],
  );

  const submitting = phase === "submitting";
  const passed = phase === "success";

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1 px-2 py-4 text-center",
        className,
      )}
    >
      <div className="mb-3 text-muted-foreground">
        <ShopCodeIllustration className="h-24 w-30" />
      </div>

      {showHeading ? (
        <>
          <h3 className="text-base font-semibold text-balance text-foreground">
            Enter the shop code
          </h3>
          <p className="max-w-sm text-sm text-pretty text-muted-foreground">
            The Memory Deals gives this code to its business customers. Ask
            them for it on WhatsApp or in the shop.
          </p>
        </>
      ) : null}

      {passed ? (
        <div
          role="status"
          className="mt-4 flex flex-col items-center gap-2 py-2"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-success/15 text-success">
            <CheckIcon className="size-6" aria-hidden />
          </span>
          <p className="text-sm font-medium text-foreground">
            That&rsquo;s the one — you&rsquo;re in
          </p>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          noValidate
          className="mt-4 flex w-full max-w-xs flex-col gap-3 text-left"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="shop-code">Shop code</Label>
            <Input
              id="shop-code"
              name="shopCode"
              type="text"
              autoFocus
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={64}
              placeholder="e.g. TMD-8FKP"
              value={code}
              disabled={submitting}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "shop-code-error" : undefined}
              onChange={(event) => {
                setCode(event.target.value);
                setError(null);
              }}
              className="h-10 text-center font-medium tracking-widest uppercase"
            />
          </div>

          {error ? (
            <p
              id="shop-code-error"
              role="alert"
              className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" disabled={submitting} className="w-full">
            {submitting ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : null}
            {submitting ? "Checking…" : "Continue"}
          </Button>
        </form>
      )}
    </div>
  );
}
