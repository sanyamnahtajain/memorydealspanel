"use client";

import * as React from "react";
import Image from "next/image";
import { motion, useReducedMotion } from "motion/react";
import { Loader2Icon } from "lucide-react";

import { APP_NAME } from "@/lib/constants";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { PageHeader } from "@/components/common";
import { FadeUp } from "@/components/motion/primitives";
import { GoogleSignInBlock } from "@/components/auth/GoogleSignInBlock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { contactFormSchema, CONTACT_REASON_MAX } from "@/server/actions/contact-schema";
import { submitContactAction } from "@/server/actions/contact";
import { cn } from "@/lib/utils";

/**
 * Contact-us client page. THE MODE IS LATCHED ON FIRST RENDER (same reason as
 * RequestAccessPageClient): the Google handoff is single-use and submitting
 * CONSUMES it, so a post-submit server render would peek nothing and swap this
 * tree for the "sign in with Google" card — tearing down the success screen of
 * a message that WAS sent. Latching keeps the first answer; reaching the form
 * again is a full navigation that remounts the component.
 *
 * Non-customers get a BARE page (no storefront shell): this route is exempt
 * from the shop-code wall, and the wall must not leak navigation or catalogue
 * structure to someone who has not passed it. A signed-in customer gets the
 * normal shell — they are already inside.
 */

export type ContactMode =
  | {
      kind: "customer";
      prefill: { name: string; phone: string; businessName: string; city: string };
      email: string | null;
    }
  | { kind: "google"; token: string; email: string; name: string | null }
  | { kind: "gate"; googleReady: boolean };

/* ------------------------------------------------------------------ */
/* Layout shells                                                       */
/* ------------------------------------------------------------------ */

/** Bare centred page — mirrors /gate/signin. No nav, no search, no leaks. */
function BareLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <div className="flex flex-col items-center gap-2">
        <Image
          src="/brand/logo.png"
          alt=""
          width={56}
          height={56}
          className="rounded-xl"
          priority
        />
        <h1 className="font-heading text-lg font-semibold tracking-tight text-foreground">
          {APP_NAME}
        </h1>
      </div>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm ring-1 ring-foreground/5 sm:p-6">
        {children}
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Form                                                                */
/* ------------------------------------------------------------------ */

interface FormValues {
  name: string;
  phone: string;
  businessName: string;
  city: string;
  reason: string;
}

type FieldErrors = Partial<Record<keyof FormValues, string>>;

type SubmitState =
  | { phase: "form"; error?: string }
  | { phase: "submitting" }
  | { phase: "success"; phone: string };

/** "+919876543210" → "+91 98765 43210" for the success echo. */
function formatPhone(phone: string): string {
  const match = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return match ? `+91 ${match[1]} ${match[2]}` : phone;
}

const textareaClassName =
  "min-h-28 w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40";

function ContactForm({
  initial,
  verifiedEmail,
  googleToken,
}: {
  initial: Partial<FormValues>;
  /** Shown in the "verified" badge; null for phone customers without email. */
  verifiedEmail: string | null;
  /** Single-use handoff for non-customers; absent for signed-in customers. */
  googleToken?: string;
}) {
  const [values, setValues] = React.useState<FormValues>({
    name: initial.name ?? "",
    phone: initial.phone ?? "",
    businessName: initial.businessName ?? "",
    city: initial.city ?? "",
    reason: "",
  });
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [state, setState] = React.useState<SubmitState>({ phase: "form" });

  const setField = (name: keyof FormValues, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = contactFormSchema.safeParse(values);
    if (!parsed.success) {
      const nextErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !(key in nextErrors)) {
          nextErrors[key as keyof FormValues] = issue.message;
        }
      }
      setErrors(nextErrors);
      return;
    }

    setState({ phase: "submitting" });
    try {
      const result = await submitContactAction({
        form: values,
        g: googleToken,
      });
      if (result.ok) {
        setState({ phase: "success", phone: result.phone });
      } else {
        setState({ phase: "form", error: result.error });
      }
    } catch {
      setState({
        phase: "form",
        error: "Could not send your message. Please try again.",
      });
    }
  }

  if (state.phase === "success") {
    return <SuccessScreen phone={state.phone} />;
  }

  const submitting = state.phase === "submitting";
  const formError = state.phase === "form" ? state.error : undefined;

  const field = (
    name: keyof FormValues,
    label: string,
    opts: {
      required?: boolean;
      type?: string;
      inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
      placeholder?: string;
      autoComplete?: string;
    } = {},
  ) => {
    const error = errors[name];
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`contact-${name}`}>
          {label}
          {opts.required ? (
            <span aria-hidden className="text-destructive">
              *
            </span>
          ) : null}
        </Label>
        <Input
          id={`contact-${name}`}
          name={name}
          type={opts.type ?? "text"}
          inputMode={opts.inputMode}
          placeholder={opts.placeholder}
          autoComplete={opts.autoComplete}
          value={values[name]}
          disabled={submitting}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `contact-${name}-error` : undefined}
          onChange={(e) => setField(name, e.target.value)}
        />
        {error ? (
          <p id={`contact-${name}-error`} className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      {verifiedEmail ? (
        <div className="rounded-lg border border-success/35 bg-success/10 px-3 py-2.5">
          <p className="truncate text-sm font-medium text-foreground">
            {verifiedEmail}
          </p>
          <p className="text-xs text-success">Signed in with Google</p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {field("name", "Your name", {
          required: true,
          placeholder: "Rahul Sharma",
          autoComplete: "name",
        })}
        {field("phone", "Mobile number", {
          required: true,
          type: "tel",
          inputMode: "tel",
          placeholder: "98765 43210",
          autoComplete: "tel",
        })}
        {field("businessName", "Shop name (optional)", {
          placeholder: "Acme Traders",
          autoComplete: "organization",
        })}
        {field("city", "City (optional)", {
          placeholder: "Mumbai",
          autoComplete: "address-level2",
        })}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contact-reason">
          Why do you want to contact us?
          <span aria-hidden className="text-destructive">
            *
          </span>
        </Label>
        <textarea
          id="contact-reason"
          name="reason"
          value={values.reason}
          disabled={submitting}
          maxLength={CONTACT_REASON_MAX}
          placeholder="Tell us what you need. We will call you back."
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={errors.reason ? "contact-reason-error" : undefined}
          onChange={(e) => setField("reason", e.target.value)}
          className={cn(textareaClassName)}
        />
        <div className="flex items-start justify-between gap-2">
          {errors.reason ? (
            <p id="contact-reason-error" className="text-xs text-destructive">
              {errors.reason}
            </p>
          ) : (
            <span />
          )}
          <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {values.reason.length}/{CONTACT_REASON_MAX}
          </p>
        </div>
      </div>

      {formError ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {formError}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={submitting} className="w-full">
        {submitting ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
        {submitting ? "Sending…" : "Send message"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        You can send up to 3 messages. The shop calls back on the number you
        give.
      </p>
    </form>
  );
}

function SuccessScreen({ phone }: { phone: string }) {
  const reduced = useReducedMotion();
  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center">
      <motion.div
        className="flex size-16 items-center justify-center rounded-full bg-success/15 text-success"
        initial={reduced ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 22 }}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden className="size-8">
          <motion.path
            d="M5 13l4 4L19 7"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={reduced ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.4, delay: 0.15, ease: "easeOut" }}
          />
        </svg>
      </motion.div>
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">
          We got your message
        </h2>
        <p className="max-w-xs text-sm text-pretty text-muted-foreground">
          The shop will call you on{" "}
          <span className="font-medium whitespace-nowrap text-foreground">
            {formatPhone(phone)}
          </span>
          .
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function ContactPageClient({ mode }: { mode: ContactMode }) {
  // Captured once, on mount — see the component doc block.
  const [latched] = React.useState(mode);

  if (latched.kind === "customer") {
    return (
      <StorefrontShell>
        <div className="mx-auto max-w-lg py-6 md:py-10">
          <PageHeader
            title="Contact us"
            description="Send us a message and we will call you back."
            backHref="/account"
            backLabel="Account"
          />
          <FadeUp>
            <div className="mt-6 rounded-xl border border-border bg-card p-5 md:p-6">
              <ContactForm
                initial={latched.prefill}
                verifiedEmail={latched.email}
              />
            </div>
          </FadeUp>
        </div>
      </StorefrontShell>
    );
  }

  if (latched.kind === "google") {
    return (
      <BareLayout>
        <div className="mb-4 space-y-1">
          <h2 className="font-heading text-lg font-semibold tracking-tight text-foreground">
            Contact us
          </h2>
          <p className="text-sm text-muted-foreground">
            Send us a message and we will call you back.
          </p>
        </div>
        <ContactForm
          initial={{ name: latched.name ?? "" }}
          verifiedEmail={latched.email}
          googleToken={latched.token}
        />
      </BareLayout>
    );
  }

  return (
    <BareLayout>
      {latched.googleReady ? (
        <GoogleSignInBlock
          href="/auth/google/start?returnTo=/contact"
          headline="Contact us"
          sub="First sign in with Google so we know you are a real person. Then write your message — we will call you back."
          footnote="Signing in here does not make an account. It only lets you send a message."
        />
      ) : (
        <div className="space-y-1.5">
          <h2 className="font-heading text-lg font-semibold tracking-tight text-foreground">
            Contact us
          </h2>
          <p className="text-sm text-muted-foreground">
            Sending messages is not ready right now. Please try again later.
          </p>
        </div>
      )}
    </BareLayout>
  );
}
