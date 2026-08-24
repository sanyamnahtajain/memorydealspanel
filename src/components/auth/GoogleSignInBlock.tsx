import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * GoogleSignInBlock — THE single shared "Continue with Google" entry point
 * (owner request: the login page and the request-access sheet must be the same
 * piece of code). Pure presentation, no state; renders an optional headline /
 * sub line, the Google button, and an optional footnote.
 *
 * Server-safe (no hooks), so it can sit inside server pages and client
 * components alike.
 */
export interface GoogleSignInBlockProps {
  /** The OAuth start URL (e.g. `/auth/google/start?returnTo=...`). */
  href: string;
  /** Optional heading above the button. */
  headline?: string;
  /** Optional supporting line under the headline / above the button. */
  sub?: string;
  /** Optional small print under the button. */
  footnote?: string;
  className?: string;
}

/** The multicolour Google "G" — brand colours are fixed, theme-independent. */
function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-4.5">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.46a5.53 5.53 0 0 1-2.4 3.62v3h3.88c2.27-2.1 3.56-5.17 3.56-8.8z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.28 14.29a7.2 7.2 0 0 1 0-4.58v-3.1H1.27a12 12 0 0 0 0 10.78l4.01-3.1z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.6 4.59 1.8l3.44-3.44A11.98 11.98 0 0 0 1.27 6.6l4.01 3.1C6.22 6.88 8.87 4.77 12 4.77z" />
    </svg>
  );
}

export function GoogleSignInBlock({
  href,
  headline,
  sub,
  footnote,
  className,
}: GoogleSignInBlockProps) {
  return (
    <div
      data-slot="google-signin"
      className={cn("flex w-full flex-col gap-3", className)}
    >
      {headline || sub ? (
        <div className="space-y-1.5">
          {headline ? (
            <h2 className="font-heading text-lg font-semibold tracking-tight text-foreground">
              {headline}
            </h2>
          ) : null}
          {sub ? <p className="text-sm text-muted-foreground">{sub}</p> : null}
        </div>
      ) : null}
      <a
        href={href}
        className="inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-border bg-background text-sm font-semibold text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <GoogleMark />
        Continue with Google
      </a>
      {footnote ? (
        <p className="text-center text-xs text-muted-foreground">{footnote}</p>
      ) : null}
    </div>
  );
}
