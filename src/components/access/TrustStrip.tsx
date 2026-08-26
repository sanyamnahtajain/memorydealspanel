"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAccessStatus } from "@/components/access/useAccessStatus";
import { trustStripLabel } from "@/components/access/trust-strip-label";

/**
 * TrustStrip — the healthy-state counterpart of AccessStatusBanner: a small,
 * quiet line for APPROVED buyers so a retailer always knows where they stand
 * without asking ("Prices open · till 23 Sept · 12 orders").
 *
 * Mounted in the same shell slot as the banner. The two are mutually
 * exclusive by construction: the banner renders only for problem states
 * (expired / rejected / pending / expiring) and this renders ONLY for
 * "active" — "expiring" belongs to the banner even though prices still work.
 *
 * Renders NOTHING until the shared snapshot resolves (enhancement pattern —
 * no skeleton, no flash), nothing on /account (that page already shows the
 * full status card) and nothing on /gate paths. One line always: truncates,
 * never wraps. The whole strip is a tap-through to /account.
 */
export function TrustStrip() {
  const { snapshot } = useAccessStatus();
  const pathname = usePathname() ?? "/";

  // Exactly /account — same reasoning as the banner: the account page IS the
  // status page (full card, same facts), so the strip would say it twice.
  // Deeper pages (orders, cart) still get the strip. /gate is the access
  // funnel — status chrome there would fight the gate's own messaging.
  if (pathname === "/account" || pathname.startsWith("/gate")) {
    return null;
  }

  const label = trustStripLabel(snapshot);
  if (!label) return null;

  return (
    <Link
      href="/account"
      className="block border-b border-border/60 bg-muted/40 outline-none focus-visible:bg-muted"
    >
      <span className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-1.5 md:px-6">
        <span
          className="size-1.5 shrink-0 rounded-full bg-success"
          aria-hidden
        />
        <span className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">
          {label}
        </span>
      </span>
    </Link>
  );
}
