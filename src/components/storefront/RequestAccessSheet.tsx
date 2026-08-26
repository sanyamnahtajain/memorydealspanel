"use client";

/**
 * RequestAccessSheet — the F-C7 access-request form, presented as a bottom
 * Sheet on mobile and a centered Dialog on desktop (matching ConfirmSheet's
 * responsive pattern; both are Base UI dialogs under the hood).
 *
 * Flow:
 *   form → inline zod validation (accessRequestSchema) → Cloudflare Turnstile
 *   (only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set) → requestAccess server
 *   action → success / duplicate / error states.
 *
 * The component holds NO pricing and never reads a product — it exists purely
 * to convert an anon/pending viewer into a pending customer.
 */

import * as React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { Loader2Icon, ShieldCheckIcon } from "lucide-react";

import { GoogleSignInBlock } from "@/components/auth/GoogleSignInBlock";

import { Button } from "@/components/ui/button";
import { SlabyBadge } from "@/components/slaby/SlabyMark";
import { useSlabyBranding } from "@/components/slaby/useSlabyBranding";
import { slabyPlacementOn } from "@/lib/slaby/branding";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { StatusChip } from "@/components/common/StatusChip";
import { RequestApprovedNudge } from "@/components/notify/RequestApprovedNudge";
import { CelebrationOverlay } from "@/components/common/CelebrationOverlay";
import { CityField } from "@/components/storefront/CityField";
import { useIsMobile } from "@/components/common/use-is-mobile";
import { ShopCodeGate } from "@/components/storefront/ShopCodeGate";
import { accessRequestSchema } from "@/lib/schemas/customer";
import { requestAccess, requestAccessViaGoogle } from "@/server/actions/access";
import { entryGateStatusAction } from "@/server/actions/entry-gate";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Turnstile                                                          */
/* ------------------------------------------------------------------ */

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
        },
      ) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId?: string) => void;
    };
  }
}

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * Renders a Cloudflare Turnstile widget when a site key is configured,
 * lifting the resulting token to the parent. Renders nothing (and the form
 * proceeds token-less) when no key is set — the intended dev behaviour.
 */
function TurnstileWidget({
  onToken,
}: {
  onToken: (token: string) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const onTokenRef = React.useRef(onToken);
  React.useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  React.useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let widgetId: string | undefined;
    let cancelled = false;

    function mount() {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      widgetId = window.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITE_KEY!,
        theme: "auto",
        callback: (token) => onTokenRef.current(token),
        "error-callback": () => onTokenRef.current(""),
        "expired-callback": () => onTokenRef.current(""),
      });
    }

    if (window.turnstile) {
      mount();
    } else {
      const existing = document.querySelector<HTMLScriptElement>(
        `script[src="${TURNSTILE_SCRIPT_SRC}"]`,
      );
      const script = existing ?? document.createElement("script");
      if (!existing) {
        script.src = TURNSTILE_SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", mount, { once: true });
    }

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) {
        try {
          window.turnstile.remove(widgetId);
        } catch {
          /* widget already gone */
        }
      }
    };
  }, []);

  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={containerRef} className="flex justify-center" />;
}

/* ------------------------------------------------------------------ */
/* Form                                                               */
/* ------------------------------------------------------------------ */

interface FieldDef {
  name: keyof FormValues;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}

interface FormValues {
  businessName: string;
  contactName: string;
  phone: string;
  password: string;
  gstNumber: string;
  email: string;
  city: string;
}

const EMPTY_FORM: FormValues = {
  businessName: "",
  contactName: "",
  phone: "",
  password: "",
  gstNumber: "",
  email: "",
  city: "",
};

const FIELDS: FieldDef[] = [
  {
    name: "businessName",
    label: "Business name",
    required: true,
    placeholder: "Acme Traders",
    autoComplete: "organization",
  },
  {
    name: "contactName",
    label: "Your name",
    required: true,
    placeholder: "Rahul Sharma",
    autoComplete: "name",
  },
  {
    name: "phone",
    label: "Mobile number",
    required: true,
    type: "tel",
    inputMode: "tel",
    placeholder: "98765 43210",
    autoComplete: "tel",
  },
  {
    name: "password",
    label: "Password",
    required: true,
    type: "password",
    placeholder: "At least 8 characters",
    autoComplete: "new-password",
  },
  {
    name: "gstNumber",
    label: "GSTIN (optional)",
    placeholder: "27AAPFU0939F1ZV",
    autoComplete: "off",
  },
  {
    name: "email",
    label: "Email (optional)",
    type: "email",
    inputMode: "email",
    placeholder: "you@business.com",
    autoComplete: "email",
  },
  {
    name: "city",
    label: "City",
    required: true,
    placeholder: "Mumbai",
    autoComplete: "address-level2",
  },
];

type FieldErrors = Partial<Record<keyof FormValues, string>>;

type SubmitState =
  | { phase: "form" }
  | { phase: "submitting" }
  | { phase: "success"; duplicate: boolean }
  | { phase: "duplicate-approved" }
  /** Google sign-in matched an existing customer — admin approval pending. */
  | { phase: "link-requested"; duplicate: boolean }
  | { phase: "error"; message: string };

interface RequestAccessFormProps {
  onClose: () => void;
  /** Google-authenticated signup (T-google): the peeked handoff. When set,
   *  password + email fields are replaced by a verified badge; the submit
   *  action consumes the token and uses ITS email — never the form's. */
  google?: { token: string; email: string; name: string | null } | null;
}

/**
 * The half-filled form is kept in sessionStorage.
 *
 * The Google signup handoff is single-use and time-limited, so a visitor can
 * reach Submit only to be told to sign in again. Sending them back through
 * Google is fine; making them retype their business name, phone, GSTIN and
 * city is not — that is where people give up. The draft survives the round
 * trip, so re-authenticating costs one tap and nothing else.
 *
 * Session-scoped (not localStorage) so it disappears when the tab closes, and
 * the password is never written — see toDraft.
 */
const DRAFT_KEY = "md-request-access-draft";

/** Everything except the password, which must never be persisted. */
function toDraft(values: FormValues): Partial<FormValues> {
  const { password: _password, ...rest } = values;
  return rest;
}

function saveDraft(values: FormValues): void {
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(toDraft(values)));
  } catch {
    /* private mode / storage full — the draft simply won't persist */
  }
}

function readDraft(): Partial<FormValues> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    // Only keep known string fields — a hand-edited blob cannot inject keys.
    const out: Partial<FormValues> = {};
    for (const key of Object.keys(EMPTY_FORM) as (keyof FormValues)[]) {
      const value = (parsed as Record<string, unknown>)[key];
      if (key !== "password" && typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return null;
  }
}

function clearDraft(): void {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

export function RequestAccessForm({ onClose, google = null }: RequestAccessFormProps) {
  const viaGoogle = Boolean(google);
  const [values, setValues] = React.useState<FormValues>(() => {
    // A draft from before a Google round trip wins over the empty form, but
    // the verified Google identity always wins over the draft.
    const draft = readDraft() ?? {};
    return {
      ...EMPTY_FORM,
      ...draft,
      contactName: draft.contactName || (google?.name ?? ""),
      email: google?.email ?? draft.email ?? "",
    };
  });
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [token, setToken] = React.useState("");
  const [state, setState] = React.useState<SubmitState>({ phase: "form" });

  const setField = React.useCallback(
    (name: keyof FormValues, value: string) => {
      setValues((prev) => {
        const next = { ...prev, [name]: value };
        saveDraft(next);
        return next;
      });
      setErrors((prev) => {
        if (!prev[name]) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      });
    },
    [],
  );

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const parsed = accessRequestSchema.safeParse(
        google
          ? { ...values, password: "google-oauth-login", email: google.email }
          : values,
      );
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
        const result = google
          ? await requestAccessViaGoogle({
              form: {
                businessName: parsed.data.businessName,
                contactName: parsed.data.contactName,
                phone: parsed.data.phone,
                gstNumber: parsed.data.gstNumber,
                city: parsed.data.city,
              },
              g: google.token,
            })
          : await requestAccess({
              form: parsed.data,
              turnstileToken: token,
            });
        if (result.ok) {
          if ("signedIn" in result) {
            // Their Google email WAS the customer's own, so they are already
            // signed in. Take them to their account rather than showing a
            // "request received" screen for a request that never happened.
            clearDraft();
            window.location.assign("/account");
            return;
          }
          if ("linkRequested" in result) {
            clearDraft();
            setState({ phase: "link-requested", duplicate: result.duplicate });
            return;
          }
          clearDraft();
          setState({ phase: "success", duplicate: result.duplicate });
        } else {
          setState({ phase: "error", message: result.error });
        }
      } catch {
        setState({
          phase: "error",
          message: "Could not submit your request. Please try again.",
        });
      }
    },
    [values, token, google],
  );

  if (state.phase === "link-requested") {
    return <LinkRequestedState duplicate={state.duplicate} onClose={onClose} />;
  }

  if (state.phase === "success") {
    return (
      <SuccessState duplicate={state.duplicate} onClose={onClose} />
    );
  }

  const submitting = state.phase === "submitting";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      {viaGoogle ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-success/35 bg-success/10 px-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{google?.email}</p>
            <p className="text-xs text-success">Verified with Google — no password needed</p>
          </div>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.filter(
          (f) => !viaGoogle || (f.name !== "password" && f.name !== "email"),
        ).map((field) => {
          const error = errors[field.name];
          const spanFull =
            field.name === "businessName" || field.name === "password";
          return (
            <div
              key={field.name}
              className={cn("flex flex-col gap-1.5", spanFull && "sm:col-span-2")}
            >
              <Label htmlFor={`ra-${field.name}`}>
                {field.label}
                {field.required ? (
                  <span aria-hidden className="text-destructive">
                    *
                  </span>
                ) : null}
              </Label>
              {field.name === "city" ? (
                <CityField
                  id={`ra-${field.name}`}
                  name={field.name}
                  source="static"
                  placeholder={field.placeholder}
                  autoComplete={field.autoComplete}
                  value={values.city}
                  disabled={submitting}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `ra-${field.name}-error` : undefined}
                  onValueChange={(v) => setField("city", v)}
                />
              ) : (
                <Input
                  id={`ra-${field.name}`}
                  name={field.name}
                  type={field.type ?? "text"}
                  inputMode={field.inputMode}
                  placeholder={field.placeholder}
                  autoComplete={field.autoComplete}
                  value={values[field.name]}
                  disabled={submitting}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `ra-${field.name}-error` : undefined}
                  onChange={(e) => setField(field.name, e.target.value)}
                />
              )}
              {error ? (
                <p
                  id={`ra-${field.name}-error`}
                  className="text-xs text-destructive"
                >
                  {error}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      {viaGoogle ? null : <TurnstileWidget onToken={setToken} />}

      {state.phase === "error" ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.message}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={submitting} className="w-full">
        {submitting ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
        {submitting ? "Submitting…" : "Request price access"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Already requested?{" "}
        <Link
          href="/account/login"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Log in
        </Link>{" "}
        to check your status.
      </p>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Success                                                            */
/* ------------------------------------------------------------------ */

function SuccessState({
  duplicate,
  onClose,
}: {
  duplicate: boolean;
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  // Full-screen celebration on a FRESH submission (not the duplicate notice);
  // plays once, then the sheet's own success content stands.
  const [overlay, setOverlay] = React.useState(false);
  React.useEffect(() => {
    if (duplicate) return;
    const t = setTimeout(() => setOverlay(true), 0);
    return () => clearTimeout(t);
  }, [duplicate]);
  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center">
      {overlay ? (
        <CelebrationOverlay
          title="Request sent!"
          subtitle="We'll review it shortly — you'll unlock wholesale prices once approved."
          durationMs={2000}
          onDone={() => setOverlay(false)}
        />
      ) : null}
      <motion.div
        className="flex size-16 items-center justify-center rounded-full bg-success/15 text-success"
        initial={reduced ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 22 }}
      >
        <motion.span
          initial={reduced ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
            className="size-8"
          >
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
        </motion.span>
      </motion.div>

      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-foreground">
          {duplicate ? "You're already in the queue" : "Request received"}
        </h3>
        <p className="max-w-xs text-sm text-pretty text-muted-foreground">
          {duplicate
            ? "We already have a pending request for this number. We'll review it shortly — log in anytime to check your status."
            : "We'll review it shortly. Log in anytime to check your status and unlock prices once approved."}
        </p>
      </div>

      <StatusChip variant="pending" label="Awaiting approval" />

      {/* The highest-intent moment in the app: they have just asked for
          something and want the answer. Offer to bring it to them. */}
      <RequestApprovedNudge className="mt-1" />

      <Button variant="outline" onClick={onClose} className="mt-2 w-full">
        Done
      </Button>
    </div>
  );
}

/**
 * Shown when a Google visitor turns out to BE an existing customer, but we
 * could not prove it: they typed a known phone number, and a typed number is
 * not proof. The admin approves the connection.
 *
 * The old behaviour here was a red error telling them to "sign in with the
 * same Google account" — impossible advice, since the account they were
 * holding IS the one they signed in with. This is not an error at all, so it
 * does not look like one.
 */
function LinkRequestedState({
  duplicate,
  onClose,
}: {
  duplicate: boolean;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
        <ShieldCheckIcon className="size-8" aria-hidden />
      </span>

      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-foreground">
          {duplicate ? "We are still checking" : "We know this number"}
        </h3>
        <p className="max-w-xs text-sm text-pretty text-muted-foreground">
          {duplicate
            ? "We already asked the shop to connect this Google sign-in to your account. We will tell you as soon as they say yes."
            : "You already have an account with this number. We have asked the shop to connect this Google sign-in to it. We will tell you as soon as they say yes."}
        </p>
      </div>

      <StatusChip variant="pending" label="Waiting for the shop" />

      <p className="max-w-xs text-xs text-muted-foreground">
        Have a password for this number? You can sign in with it right now.
      </p>

      <div className="mt-1 flex w-full flex-col gap-2">
        <Button render={<Link href="/account/login" />} className="w-full">
          Sign in with my number
        </Button>
        <Button variant="outline" onClick={onClose} className="w-full">
          Done
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Responsive shell                                                   */
/* ------------------------------------------------------------------ */

/* Per-variant header copy: the password form asks for business details, the
 * Google gate is simply "sign in" (owner request — a signed-out tap on a price
 * must read as one login flow, not a form). Kept as module consts. */
const FORM_TITLE = "Request price access";
const FORM_DESCRIPTION =
  "Tell us about your business. Once approved you'll see live wholesale prices across the catalog.";
const GOOGLE_TITLE = "Sign in to see prices";
const GOOGLE_DESCRIPTION =
  "Approved retailers see live wholesale pricing across the catalog.";
const SHOP_CODE_TITLE = "Enter the shop code";
const SHOP_CODE_DESCRIPTION =
  "The Memory Deals gives this code to its business customers. Ask them for it on WhatsApp or in the shop.";

export interface RequestAccessSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Google-only storefront: when set, the sheet shows the Continue-with-
   *  Google gate instead of the password form (new visitors return to the
   *  request form with a verified-email token; existing ones sign in). */
  googleGateHref?: string | null;
}

/** The Continue-with-Google gate used by the sheet AND the standalone page.
 *  Thin wrapper over the ONE shared {@link GoogleSignInBlock} so the sheet and
 *  the login page render the identical piece of code. */
export function GoogleAccessGate({ href }: { href: string }) {
  return (
    <GoogleSignInBlock
      href={href}
      sub="Sign in with Google to continue. New customers then share business details for review; approved customers go straight in."
      className="mx-auto max-w-xs items-center py-4 text-center"
    />
  );
}

/**
 * Controlled request-access surface. Open it from a "See price" affordance
 * (PriceGateCard) or any CTA. Bottom sheet on mobile, dialog on desktop.
 */
export function RequestAccessSheet({
  open,
  onOpenChange,
  googleGateHref = null,
}: RequestAccessSheetProps) {
  const isMobile = useIsMobile();
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);

  // Remount the form on each open so a previous success/error doesn't linger.
  const formKey = open ? "open" : "closed";

  /* Shop code (entry gate). The sheet fetches nothing server-side, so on
   * first open we ask the server whether THIS device still needs the code.
   * `null` = answer not in yet (show the spinner); the answer is latched for
   * the sheet's lifetime — passing the code flips it to false locally, and
   * the server actions enforce the gate regardless of what we render. */
  const [shopCodeNeeded, setShopCodeNeeded] = React.useState<boolean | null>(
    null,
  );
  const checkStartedRef = React.useRef(false);
  React.useEffect(() => {
    if (!open || checkStartedRef.current) return;
    checkStartedRef.current = true;
    entryGateStatusAction()
      .then((res) => setShopCodeNeeded(res.ok ? res.required : false))
      // Fail open: this screen only reduces queue noise, and the submit
      // action refuses on its own if the code was really required.
      .catch(() => setShopCodeNeeded(false));
  }, [open]);

  const checkingShopCode = shopCodeNeeded === null;
  const showShopCode = shopCodeNeeded === true;

  // Per-variant header: the Google gate is a sign-in, not a form. While the
  // status check runs we keep the usual header — it only swaps to the
  // shop-code copy once we know the code is actually needed.
  const title = showShopCode
    ? SHOP_CODE_TITLE
    : googleGateHref
      ? GOOGLE_TITLE
      : FORM_TITLE;
  const description = showShopCode
    ? SHOP_CODE_DESCRIPTION
    : googleGateHref
      ? GOOGLE_DESCRIPTION
      : FORM_DESCRIPTION;

  // ShopCodeGate hides its own heading here — the sheet/dialog header above
  // already carries the title and explanation.
  const body = checkingShopCode ? (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-40 items-center justify-center py-6 text-muted-foreground"
    >
      <Spinner size="lg" label="Checking" />
    </div>
  ) : showShopCode ? (
    <ShopCodeGate
      showHeading={false}
      onPassed={() => setShopCodeNeeded(false)}
    />
  ) : googleGateHref ? (
    <GoogleAccessGate href={googleGateHref} />
  ) : (
    <RequestAccessForm key={formKey} onClose={close} />
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton
          className="max-h-[92dvh] overflow-y-auto rounded-t-2xl pb-safe"
        >
          <div
            aria-hidden
            className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted"
          />
          <SheetHeader className="pb-1 text-center">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            {body}
            <RequestAccessSlabyBadge />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {body}
        <RequestAccessSlabyBadge />
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Built with Slaby" under the request-access form — owner-toggleable
 * (requestAccess placement). Reads the config client-side so the sheet's many
 * mount sites need no prop threading; renders nothing until (and unless) the
 * toggle is on.
 */
function RequestAccessSlabyBadge() {
  const config = useSlabyBranding();
  if (!slabyPlacementOn(config, "requestAccess")) return null;
  return (
    <div className="mt-3 flex justify-center">
      <SlabyBadge placement="requestAccess" />
    </div>
  );
}
