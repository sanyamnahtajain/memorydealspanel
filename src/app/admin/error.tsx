"use client";

import * as React from "react";
import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Admin segment error boundary (App Router `error.tsx`).
 *
 * Catches render/data errors thrown anywhere under `/admin` and shows a
 * branded, token-styled fallback with a Retry action that re-runs the failed
 * segment via `reset()`. The raw error is never surfaced — only React's opaque
 * `digest` (useful for correlating with server logs) is shown, small and muted.
 *
 * This boundary is a plain centered card (it renders inside the admin route but
 * cannot assume the shell mounted, since the shell itself may have thrown).
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Surface to the browser console for local debugging; production logging
    // is handled server-side and correlated via `error.digest`.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangleIcon className="size-6" aria-hidden />
        </div>
        <h1 className="mt-5 font-heading text-lg font-semibold text-balance">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-pretty text-muted-foreground">
          We hit an unexpected error loading this admin page. You can retry, or
          head back and try again.
        </p>

        {error.digest ? (
          <p className="mt-4 font-tabular text-xs text-muted-foreground/70">
            Reference: {error.digest}
          </p>
        ) : null}

        <div className="mt-6 flex items-center justify-center gap-2">
          <Button onClick={reset}>
            <RotateCcwIcon aria-hidden />
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}
