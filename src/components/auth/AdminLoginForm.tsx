"use client";

import * as React from "react";
import { Loader2, LockKeyhole, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScaleTap } from "@/components/motion/primitives";

/**
 * Result contract the integrator's `adminLogin` server action must satisfy.
 * The form is fully decoupled from the action via the `onSubmit` prop — it
 * only knows this shape, so it can be unit-tested and previewed without a DB.
 *
 * - `ok`            — credentials (and TOTP, if required) accepted; the caller
 *                     handles redirect via `onSuccess`.
 * - `totp_required` — email + password verified; prompt for the 6-digit code.
 *                     The form transitions to the TOTP step and re-submits the
 *                     same credentials plus the code.
 * - `error`         — anything else; `message` is shown inline.
 */
export type AdminLoginResult =
  | { status: "ok" }
  | { status: "totp_required" }
  | { status: "error"; message: string };

export interface AdminLoginValues {
  email: string;
  password: string;
  /** Present only on the second submit, once the TOTP step is shown. */
  totp?: string;
}

export interface AdminLoginFormProps {
  /**
   * Performs the login. Integrator passes the real `adminLogin` server action
   * (optionally wrapped to marshal a plain object into FormData). Must resolve
   * to an {@link AdminLoginResult}; thrown errors are caught and shown inline.
   */
  onSubmit: (values: AdminLoginValues) => Promise<AdminLoginResult>;
  /** Called after a successful login — integrator redirects to the dashboard. */
  onSuccess?: () => void;
  className?: string;
}

/**
 * Admin sign-in form (on-brand dark surface).
 *
 * Two-step: email + password first; if the action returns `totp_required`,
 * the form swaps to a focused 6-digit authenticator step while preserving the
 * entered credentials. Inline errors, disabled/loading states, ScaleTap press
 * feedback on the submit button.
 */
export function AdminLoginForm({
  onSubmit,
  onSuccess,
  className,
}: AdminLoginFormProps) {
  const [step, setStep] = React.useState<"credentials" | "totp">("credentials");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [totp, setTotp] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const totpRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (step === "totp") totpRef.current?.focus();
  }, [step]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const result = await onSubmit({
        email: email.trim(),
        password,
        totp: step === "totp" ? totp.trim() : undefined,
      });
      switch (result.status) {
        case "ok":
          onSuccess?.();
          return;
        case "totp_required":
          setStep("totp");
          setError(null);
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

  const inTotp = step === "totp";

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      className={cn(
        "w-full space-y-5 rounded-2xl border border-white/10 bg-neutral-950/60 p-6 text-neutral-100 shadow-2xl backdrop-blur supports-backdrop-filter:bg-neutral-950/40 sm:p-7",
        className,
      )}
    >
      <header className="space-y-1.5">
        <div className="flex size-10 items-center justify-center rounded-xl bg-white/5 ring-1 ring-white/10">
          <ShieldCheck className="size-5 text-primary" aria-hidden />
        </div>
        <h1 className="font-heading text-lg font-semibold tracking-tight">
          {inTotp ? "Two-factor authentication" : "Admin sign in"}
        </h1>
        <p className="text-sm text-neutral-400">
          {inTotp
            ? "Enter the 6-digit code from your authenticator app."
            : "Restricted area. Staff credentials required."}
        </p>
      </header>

      {error ? (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      {!inTotp ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="admin-email" className="text-neutral-300">
              Email
            </Label>
            <Input
              id="admin-email"
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              required
              value={email}
              disabled={pending}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@memorydeals.test"
              className="border-white/15 bg-white/5 text-neutral-100 placeholder:text-neutral-500"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-password" className="text-neutral-300">
              Password
            </Label>
            <Input
              id="admin-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              disabled={pending}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="border-white/15 bg-white/5 text-neutral-100 placeholder:text-neutral-500"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="admin-totp" className="text-neutral-300">
            Authentication code
          </Label>
          <Input
            id="admin-totp"
            ref={totpRef}
            name="totp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            required
            value={totp}
            disabled={pending}
            onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
            placeholder="123456"
            className="border-white/15 bg-white/5 text-center font-tabular text-lg tracking-[0.4em] text-neutral-100 placeholder:tracking-normal placeholder:text-neutral-500"
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setStep("credentials");
              setTotp("");
              setError(null);
            }}
            className="text-xs text-neutral-400 underline-offset-4 hover:text-neutral-200 hover:underline disabled:opacity-50"
          >
            Use a different account
          </button>
        </div>
      )}

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
            <LockKeyhole className="size-4" aria-hidden />
          )}
          {inTotp ? "Verify code" : "Sign in"}
        </Button>
      </ScaleTap>
    </form>
  );
}
