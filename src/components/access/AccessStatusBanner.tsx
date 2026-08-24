"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Info, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import {
  accessCopy,
  resolveAccessState,
  type AccessState,
} from "@/lib/access-status";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAccessStatus } from "@/components/access/useAccessStatus";
import {
  RenewAccessDialog,
  type RenewAccessState,
} from "@/components/access/RenewAccessDialog";

/**
 * AccessStatusBanner — slim, full-width status strip mounted in the
 * storefront shell directly under the sticky header. One line of truth for
 * customers whose access needs attention:
 *
 *   - expired / rejected  → warning, persistent (dismiss collapses it for the
 *                           current page view only), CTA opens the one-tap
 *                           RenewAccessDialog.
 *   - pending             → info, dismissible for the browsing session.
 *   - expiring            → warning, at most one nudge per day (localStorage
 *                           cap), CTA links into the catalog (ordering
 *                           auto-extends access).
 *
 * Renders NOTHING until the shared access snapshot has loaded (it's an
 * enhancement — no flash, no skeleton) and nothing for anon/active/blocked
 * viewers. In normal flow, so it never fights the mobile tab bar.
 */

const BANNER_STATES = ["expired", "rejected", "pending", "expiring"] as const;
type BannerState = (typeof BANNER_STATES)[number];

function isBannerState(state: AccessState): state is BannerState {
  return (BANNER_STATES as readonly AccessState[]).includes(state);
}

/** Session-scoped dismissal flag for the pending banner. */
const PENDING_DISMISS_KEY = "md-access-banner-pending";
/** Timestamp (ms) of the last dismissed expiring nudge — capped to 1/day. */
const NUDGE_AT_KEY = "md-access-nudge-at";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `storage` fires for cross-document changes only; this component's own
 * `dismiss()` drives an immediate local override, so the listener exists to
 * keep the subscription contract honest (same pattern as ExpiryBanner).
 */
function subscribeToStorage(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

/** Is this state's banner suppressed by its persisted dismissal, right now? */
function readStorageHidden(state: BannerState): boolean {
  try {
    if (state === "pending") {
      return window.sessionStorage.getItem(PENDING_DISMISS_KEY) === "1";
    }
    if (state === "expiring") {
      const at = Number(window.localStorage.getItem(NUDGE_AT_KEY) ?? 0);
      return Number.isFinite(at) && at > 0 && Date.now() - at < DAY_MS;
    }
  } catch {
    // Storage unavailable (private mode) — just show the banner.
  }
  // expired / rejected are never persisted — they reappear every page load.
  return false;
}

const TONE_CLASSES: Record<"warning" | "info", string> = {
  warning:
    "border-warning/35 bg-warning/10 text-warning-foreground dark:text-warning",
  info: "border-primary/25 bg-primary/10 text-foreground",
};

export function AccessStatusBanner() {
  const { snapshot, refresh } = useAccessStatus();
  const reduced = useReducedMotion();
  const [locallyDismissed, setLocallyDismissed] = React.useState(false);
  const [renewOpen, setRenewOpen] = React.useState(false);

  const state = snapshot ? resolveAccessState(snapshot) : null;
  const bannerState = state && isBannerState(state) ? state : null;

  // Persisted dismissals, read SSR-safely (server snapshot: hidden). Only
  // meaningful once the client snapshot has resolved to a banner state.
  const storageHidden = React.useSyncExternalStore(
    subscribeToStorage,
    () => (bannerState ? readStorageHidden(bannerState) : false),
    () => true,
  );

  // No snapshot yet (enhancement — render nothing), or nothing to say.
  if (!snapshot || !bannerState || storageHidden || locallyDismissed) {
    return null;
  }

  const copy = accessCopy(bannerState, snapshot);
  const tone = copy.tone === "info" ? "info" : "warning";
  const ToneIcon = tone === "info" ? Info : AlertTriangle;
  const renewState: RenewAccessState | null =
    bannerState === "expired" || bannerState === "rejected"
      ? bannerState
      : null;

  function dismiss() {
    setLocallyDismissed(true);
    try {
      if (bannerState === "pending") {
        window.sessionStorage.setItem(PENDING_DISMISS_KEY, "1");
      } else if (bannerState === "expiring") {
        window.localStorage.setItem(NUDGE_AT_KEY, String(Date.now()));
      }
    } catch {
      // Non-fatal: storage may be unavailable (private mode).
    }
  }

  return (
    <motion.div
      role="status"
      initial={reduced ? false : { y: -8, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      className={cn("border-b", TONE_CLASSES[tone])}
    >
      {/* Items start (not centre) so a wrapped message keeps the icon and the
          buttons aligned to the first line rather than drifting down. */}
      <div className="mx-auto flex w-full max-w-6xl items-start gap-2.5 px-4 py-2.5 md:px-6">
        <ToneIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          {/* This text is the whole point of the banner, so it WRAPS. It used
              to truncate, which cut the message in half on a phone — and the
              explanation was hidden on phones entirely, where most of these
              customers read it. */}
          <p className="text-sm leading-snug font-medium">{copy.title}</p>
          <p className="mt-0.5 text-xs leading-snug opacity-80">{copy.body}</p>
        </div>

        {copy.cta === "renew" && renewState ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0 border-warning/40 bg-background/60"
            onClick={() => setRenewOpen(true)}
          >
            {copy.ctaLabel}
          </Button>
        ) : null}
        {copy.cta === "browse" ? (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 border-warning/40 bg-background/60"
            render={<Link href="/search" />}
          >
            {copy.ctaLabel}
          </Button>
        ) : null}

        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={dismiss}
          aria-label="Dismiss access status"
          className="shrink-0"
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>

      {renewState ? (
        <RenewAccessDialog
          open={renewOpen}
          onOpenChange={setRenewOpen}
          state={renewState}
          onRequested={refresh}
        />
      ) : null}
    </motion.div>
  );
}
