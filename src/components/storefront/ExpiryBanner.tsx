"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Show the banner once the grant is within this many days of expiring. */
export const EXPIRY_WARNING_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days from `now` until `expiresAt`, rounded UP so a grant lapsing in
 * 6h30m still reads as "1 day". Returns a negative number once past expiry.
 */
export function daysUntilExpiry(expiresAt: Date, now: Date = new Date()): number {
  return Math.ceil((expiresAt.getTime() - now.getTime()) / MS_PER_DAY);
}

/**
 * True when an approved customer's access grant is close enough to expiry to
 * warrant the renewal nudge (0 < days <= {@link EXPIRY_WARNING_DAYS}).
 */
export function isExpiringSoon(expiresAt: Date | null, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  const days = daysUntilExpiry(expiresAt, now);
  return days > 0 && days <= EXPIRY_WARNING_DAYS;
}

export interface ExpiryBannerProps {
  /**
   * The active grant's expiry. Accepts a `Date` or ISO string (server
   * components serialize Dates to strings across the RSC boundary). When null
   * or not expiring soon, the banner renders nothing.
   */
  expiresAt: Date | string | null;
  /** Where the renewal CTA points. Defaults to the account renewal flow. */
  renewHref?: string;
  /**
   * A stable key for the dismissed state so re-approvals surface a fresh
   * banner. Defaults to the expiry timestamp, so a renewed (later) expiry
   * resets dismissal automatically.
   */
  dismissKey?: string;
  className?: string;
}

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const DISMISS_PREFIX = "md.expiryBanner.dismissed:";

/**
 * Dismissible renewal nudge for an approved customer whose price access is
 * about to lapse. Renders only when the grant expires within
 * {@link EXPIRY_WARNING_DAYS} days. Dismissal is remembered in `sessionStorage`
 * keyed to the expiry, so a fresh grant (new expiry) shows the banner again but
 * the customer isn't nagged repeatedly within one browsing session.
 *
 * Contains NO price information — expiry timing only.
 */
export function ExpiryBanner({
  expiresAt,
  renewHref = "/account/renew",
  dismissKey,
  className,
}: ExpiryBannerProps) {
  const expiry = React.useMemo(() => toDate(expiresAt), [expiresAt]);
  const storageKey = React.useMemo(
    () => `${DISMISS_PREFIX}${dismissKey ?? expiry?.toISOString() ?? "none"}`,
    [dismissKey, expiry],
  );

  // Start dismissed until we've checked storage — avoids an SSR/CSR flash of a
  // banner the customer already closed this session. `useSyncExternalStore`
  // reads the persisted flag without a synchronous setState-in-effect (which
  // the react-hooks rules forbid), returning `true` on the server so the first
  // client paint matches SSR.
  const dismissedInStore = React.useSyncExternalStore(
    subscribeToStorage,
    () => {
      try {
        return window.sessionStorage.getItem(storageKey) === "1";
      } catch {
        return false;
      }
    },
    () => true,
  );

  // A local override lets `dismiss()` hide the banner immediately even before
  // the storage write settles.
  const [locallyDismissed, setLocallyDismissed] = React.useState(false);
  const dismissed = dismissedInStore || locallyDismissed;

  const days = expiry ? daysUntilExpiry(expiry) : 0;

  if (!expiry || days <= 0 || days > EXPIRY_WARNING_DAYS || dismissed) {
    return null;
  }

  const dayLabel = days === 1 ? "1 day" : `${days} days`;

  function dismiss() {
    setLocallyDismissed(true);
    try {
      window.sessionStorage.setItem(storageKey, "1");
    } catch {
      // Non-fatal: storage may be unavailable (private mode).
    }
  }

  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-xl border border-warning/35 bg-warning/10 px-4 py-3 text-sm text-warning-foreground dark:text-warning",
        className,
      )}
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        Your price access expires in{" "}
        <span className="font-semibold">{dayLabel}</span>. Request a renewal to
        keep seeing wholesale pricing.
      </p>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 border-warning/40 bg-background/60"
        render={<Link href={renewHref} />}
      >
        Request renewal
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        onClick={dismiss}
        aria-label="Dismiss renewal reminder"
        className="shrink-0"
      >
        <X className="size-4" aria-hidden />
      </Button>
    </div>
  );
}
