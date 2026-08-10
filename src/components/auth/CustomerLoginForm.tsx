"use client";

import * as React from "react";
import Link from "next/link";
import { Ban, Loader2, LogIn } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
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
  /** "Continue with Google" target; null/absent hides the button (env-gated). */
  googleHref?: string | null;
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
  googleHref = null,
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
    <>
    {googleHref ? (
        <div className="mb-4 flex flex-col gap-3">
          <a
            href={googleHref}
            className="inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-border bg-background text-sm font-semibold text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="size-4.5">
              <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.46a5.53 5.53 0 0 1-2.4 3.62v3h3.88c2.27-2.1 3.56-5.17 3.56-8.8z" />
              <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.1A12 12 0 0 0 12 24z" />
              <path fill="#FBBC05" d="M5.28 14.29a7.2 7.2 0 0 1 0-4.58v-3.1H1.27a12 12 0 0 0 0 10.78l4.01-3.1z" />
              <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.6 4.59 1.8l3.44-3.44A11.98 11.98 0 0 0 1.27 6.6l4.01 3.1C6.22 6.88 8.87 4.77 12 4.77z" />
            </svg>
            Continue with Google
          </a>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" aria-hidden />
            or sign in with phone
            <span className="h-px flex-1 bg-border" aria-hidden />
          </div>
        </div>
      ) : null}
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
          <PasswordInput
            id="customer-password"
            name="password"
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
    </>
  );
}
