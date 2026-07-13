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
import { motion, useReducedMotion } from "motion/react";
import { Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { StatusChip } from "@/components/common/StatusChip";
import { CityField } from "@/components/storefront/CityField";
import { useIsMobile } from "@/components/common/use-is-mobile";
import { accessRequestSchema } from "@/lib/schemas/customer";
import { requestAccess } from "@/server/actions/access";
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
  | { phase: "error"; message: string };

interface RequestAccessFormProps {
  onClose: () => void;
}

export function RequestAccessForm({ onClose }: RequestAccessFormProps) {
  const [values, setValues] = React.useState<FormValues>(EMPTY_FORM);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [token, setToken] = React.useState("");
  const [state, setState] = React.useState<SubmitState>({ phase: "form" });

  const setField = React.useCallback(
    (name: keyof FormValues, value: string) => {
      setValues((prev) => ({ ...prev, [name]: value }));
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
      const parsed = accessRequestSchema.safeParse(values);
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
        const result = await requestAccess({
          form: parsed.data,
          turnstileToken: token,
        });
        if (result.ok) {
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
    [values, token],
  );

  if (state.phase === "success") {
    return (
      <SuccessState duplicate={state.duplicate} onClose={onClose} />
    );
  }

  const submitting = state.phase === "submitting";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((field) => {
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

      <TurnstileWidget onToken={setToken} />

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
        Already requested? Just log in to check your status.
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
  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center">
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

      <Button variant="outline" onClick={onClose} className="mt-2 w-full">
        Done
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Responsive shell                                                   */
/* ------------------------------------------------------------------ */

const TITLE = "Request price access";
const DESCRIPTION =
  "Tell us about your business. Once approved you'll see live wholesale prices across the catalog.";

export interface RequestAccessSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Controlled request-access surface. Open it from a "See price" affordance
 * (PriceGateCard) or any CTA. Bottom sheet on mobile, dialog on desktop.
 */
export function RequestAccessSheet({
  open,
  onOpenChange,
}: RequestAccessSheetProps) {
  const isMobile = useIsMobile();
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);

  // Remount the form on each open so a previous success/error doesn't linger.
  const formKey = open ? "open" : "closed";

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
            <SheetTitle>{TITLE}</SheetTitle>
            <SheetDescription>{DESCRIPTION}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <RequestAccessForm key={formKey} onClose={close} />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{TITLE}</DialogTitle>
          <DialogDescription>{DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <RequestAccessForm key={formKey} onClose={close} />
      </DialogContent>
    </Dialog>
  );
}
