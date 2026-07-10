"use client";

import * as React from "react";
import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react";

import "./globals.css";

/**
 * Global error boundary (App Router `global-error.tsx`).
 *
 * This is the last-resort boundary: it catches errors thrown in the ROOT
 * layout itself, so it must render its own `<html>` / `<body>` because the
 * normal root layout (and its providers) never mounted. We import
 * `globals.css` directly so the Tailwind design tokens are available, and pin
 * the storefront light surface via an inline background/foreground so the page
 * is legible even before the theme script would have run.
 *
 * Keep this intentionally minimal — no shell, no client providers — since any
 * of those could be the source of the failure.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-dvh bg-background text-foreground">
        <main className="flex min-h-dvh items-center justify-center px-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangleIcon className="size-6" aria-hidden />
            </div>
            <h1 className="mt-5 font-heading text-lg font-semibold text-balance">
              Something went wrong
            </h1>
            <p className="mt-2 text-sm text-pretty text-muted-foreground">
              The application ran into an unexpected error. Reloading usually
              fixes it.
            </p>

            {error.digest ? (
              <p className="mt-4 font-tabular text-xs text-muted-foreground/70">
                Reference: {error.digest}
              </p>
            ) : null}

            <div className="mt-6 flex items-center justify-center">
              <button
                type="button"
                onClick={reset}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm outline-none transition-[background-color,transform] hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
              >
                <RotateCcwIcon className="size-4" aria-hidden />
                Try again
              </button>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
