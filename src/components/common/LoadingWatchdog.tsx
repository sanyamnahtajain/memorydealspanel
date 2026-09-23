"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";

/**
 * The status line inside every `loading.tsx` skeleton — with a way out.
 *
 * INCIDENT NOTE: customers reported pages that "keep loading and become a dead
 * end". Next's client router has NO timeout: a tap on a category shows the
 * skeleton and waits for the server's response forever. On a phone that
 * drops off 4G in a lift, or a server that stalls once in a while, forever is
 * exactly what happened — the skeleton was the last thing they saw.
 *
 * This is the safety net. It renders the same screen-reader status the
 * skeleton always had, and after `slowAfterMs` it also shows a visible "Still
 * loading" line with a Reload button; after `reloadAfterMs` it reloads the
 * page itself. A full reload starts from the server again with a fresh
 * connection, which is what a person stuck on a skeleton would do by hand —
 * this just does it for them, and tells them first.
 *
 * Both timers reset whenever the skeleton unmounts (the page arrived), so a
 * fast navigation never sees any of this.
 */
export function LoadingWatchdog({
  label = "Loading…",
  slowAfterMs = 8_000,
  reloadAfterMs = 25_000,
}: {
  label?: string;
  slowAfterMs?: number;
  reloadAfterMs?: number;
}) {
  const [slow, setSlow] = React.useState(false);

  React.useEffect(() => {
    const slowTimer = setTimeout(() => setSlow(true), slowAfterMs);
    const reloadTimer = setTimeout(() => {
      // reload() re-requests the CURRENT url — the destination of the stuck
      // navigation, since the router already updated the address bar.
      window.location.reload();
    }, reloadAfterMs);
    return () => {
      clearTimeout(slowTimer);
      clearTimeout(reloadTimer);
    };
  }, [slowAfterMs, reloadAfterMs]);

  return (
    <>
      <span className="sr-only" role="status">
        {label}
      </span>
      {slow ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground shadow-sm"
        >
          <span>This is taking longer than usual.</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <RefreshCw className="size-4" aria-hidden />
            Reload
          </button>
        </div>
      ) : null}
    </>
  );
}
