"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangleIcon, HomeIcon, RotateCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Storefront segment error boundary (App Router `error.tsx`).
 *
 * Catches render/data errors under the storefront route group and shows a
 * branded, token-styled fallback (light surface). Offers a Retry that re-runs
 * the failed segment via `reset()` plus a link home. The raw error message is
 * never shown — only React's opaque `digest`, small and muted.
 */
export default function StorefrontError({
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
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangleIcon className="size-6" aria-hidden />
        </div>
        <h1 className="mt-5 font-heading text-lg font-semibold text-balance">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-pretty text-muted-foreground">
          We couldn&rsquo;t load this page just now. Please try again in a
          moment.
        </p>

        {error.digest ? (
          <p className="mt-4 font-tabular text-xs text-muted-foreground/70">
            Reference: {error.digest}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button onClick={reset}>
            <RotateCcwIcon aria-hidden />
            Try again
          </Button>
          <Button variant="outline" render={<Link href="/" />}>
            <HomeIcon aria-hidden />
            Go home
          </Button>
        </div>
      </div>
    </div>
  );
}
