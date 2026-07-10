"use client";

import * as React from "react";
import Link from "next/link";
import { Ban, Loader2, LogIn } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScaleTap } from "@/components/motion/primitives";

/**
 * Result contract the integrator's `customerLogin` server action must satisfy.
 * The form is decoupled via the `onSubmit` prop and only knows this shape.
 *
 * - `ok`      — authenticated; caller redirects via `onSuccess`.
 * - `blocked` — credentials matched a BLOCKED account. Rendered distinctly
 *               (not as a generic error) with an optional reason so the buyer
 *               understands access was revoked rather than mistyped.
 * - `error`   — bad credentials / validation / rate limit; shown inline.
 */
export type CustomerLoginResult =
  | { status: "ok" }
  | { status: "blocked"; reason?: string }
  | { status: "error"; message: string };

export interface CustomerLoginValues {
  phone: string;
  password: string;
}

export interface CustomerLoginFormProps {
  /**
   * Performs the login. Integrator passes the real `customerLogin` server
   * action. Must resolve to a {@link CustomerLoginResult}; thrown errors are
   * caught and shown inline.
   */
  onSubmit: (values: CustomerLoginValues) => Promise<CustomerLoginResult>;
  /** Called after a successful login — integrator redirects to /account. */
  onSuccess?: () => void;
  className?: string;
}

/**
 * Customer sign-in form (light storefront surface).
 *
 * Phone + password. A BLOCKED account gets a visually distinct callout with
 * its reason instead of the inline "wrong credentials" error, so a revoked
 * buyer isn't sent chasing a typo. Inline errors, loading state, ScaleTap.
 */
export function CustomerLoginForm({
  onSubmit,
  onSuccess,
  className,
}: CustomerLoginFormProps) {
  const [phone, setPhone] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [blocked, setBlocked] = React.useState<{ reason?: string } | null>(
    null,
  );
  const [pending, setPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setBlocked(null);
    setPending(true);
    try {
      const result = await onSubmit({ phone: phone.trim(), password });
      switch (result.status) {
        case "ok":
          onSuccess?.();
          return;
        case "blocked":
          setBlocked({ reason: result.reason });
          return;
        case "error":
          setError(result.message);
          return;
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      className={cn(
        "w-full space-y-5 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm ring-1 ring-foreground/5 sm:p-7",
        className,
      )}
    >
      <header className="space-y-1.5">
        <h1 className="font-heading text-lg font-semibold tracking-tight">
          Sign in
        </h1>
        <p className="text-sm text-muted-foreground">
          Access your account and wholesale pricing.
        </p>
      </header>

      {blocked ? (
        <div
          role="alert"
          aria-live="assertive"
          className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm"
        >
          <Ban className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="space-y-1">
            <p className="font-medium text-destructive">
              Your account has been blocked
            </p>
            <p className="text-destructive/90">
              {blocked.reason?.trim()
                ? blocked.reason
                : "Access to wholesale pricing has been revoked. Contact us to resolve this."}
            </p>
          </div>
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="customer-phone">Mobile number</Label>
          <Input
            id="customer-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            value={phone}
            disabled={pending}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="98765 43210"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="customer-password">Password</Label>
          <Input
            id="customer-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            disabled={pending}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
      </div>

      <ScaleTap>
        <Button
          type="submit"
          disabled={pending}
          className="h-10 w-full"
          aria-busy={pending}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <LogIn className="size-4" aria-hidden />
          )}
          Sign in
        </Button>
      </ScaleTap>

      <p className="text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link
          href="/account/request-access"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Request access
        </Link>
      </p>
    </form>
  );
}
