import type { Metadata } from "next";
import Link from "next/link";
import { Wrench } from "lucide-react";

import { getMaintenance } from "@/server/services/maintenance";
import {
  MAINTENANCE_FALLBACK_MESSAGE,
  backOnlineLabel,
} from "@/lib/maintenance";
import { APP_NAME } from "@/lib/constants";

export const metadata: Metadata = {
  title: `${APP_NAME} — back shortly`,
  // Nothing here should be indexed; the shop is temporarily dark.
  robots: { index: false, follow: false },
};

// Reads the live setting on every request: the moment the owner switches
// maintenance off, anyone sitting on this page recovers on reload.
export const dynamic = "force-dynamic";

/**
 * The maintenance screen. BARE on purpose — no shell, no nav, no footer:
 * the shop is closed, so there is nothing to navigate to, and the page must
 * render even if every catalogue query is exactly what is being worked on.
 *
 * It reads the setting directly (not through the proxy's cache) so that
 * switching maintenance OFF releases this page immediately rather than
 * stranding a visitor for the cache TTL.
 */
export default async function MaintenancePage() {
  const maintenance = await getMaintenance();

  // Already back up (or never down). NOT a redirect: this segment streams a
  // loading fallback, so the 200 is committed before this component runs and
  // a redirect() here would strand the visitor on a spinner. Render the good
  // news with a way back instead.
  if (!maintenance.enabled) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-10">
        <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">
            {APP_NAME} is open
          </h1>
          <p className="text-sm text-muted-foreground">
            Maintenance is over — the shop is back.
          </p>
          <Link
            href="/"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Go to the shop
          </Link>
        </div>
      </main>
    );
  }

  const backAt = backOnlineLabel(maintenance.until ?? null);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
        <span className="grid size-14 place-items-center rounded-2xl border border-border bg-card text-muted-foreground">
          <Wrench className="size-6" aria-hidden />
        </span>

        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">
            {APP_NAME} is back shortly
          </h1>
          <p className="text-sm leading-relaxed whitespace-pre-line [overflow-wrap:anywhere] text-muted-foreground">
            {maintenance.message ?? MAINTENANCE_FALLBACK_MESSAGE}
          </p>
        </div>

        {backAt ? (
          <p className="rounded-lg border border-border bg-muted/50 px-4 py-2.5 text-sm font-medium text-foreground">
            Expected back by {backAt}
          </p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Your cart and orders are safe. Nothing has been lost.
        </p>
      </div>
    </main>
  );
}
