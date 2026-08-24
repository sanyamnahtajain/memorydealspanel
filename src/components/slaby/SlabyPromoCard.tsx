"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, XIcon } from "lucide-react";

import { slabyHref, slabyPlacementOn } from "@/lib/slaby/branding";
import { SlabyWordmark } from "./SlabyMark";
import { useSlabyBranding } from "./useSlabyBranding";

/**
 * Occasional "This store runs on Slaby" promo card (owner-toggleable) — the
 * InstallPrompt pattern: appears after a short delay, dismiss snoozes it for
 * `promoFrequencyDays`, and it NEVER shows on the cart or during checkout so
 * no customer flow is ever blocked. Floats above the mobile tab nav.
 */

const SHOWN_AT_KEY = "md-slaby-promo-at";
/** Set on an explicit dismiss/click — the full-frequency snooze. */
const ACK_AT_KEY = "md-slaby-promo-ack-at";
const APPEAR_DELAY_MS = 6_000;
/** A mere appearance (no interaction) only pauses the card for a day. */
const SEEN_SNOOZE_MS = 24 * 60 * 60 * 1000;

/**
 * Paths where a marketing card would get in the way of the job at hand.
 * `/p/` matters most in the installed-app (PWA) view: product pages carry the
 * sticky "See price / Enquire" bar at the same bottom offset, and the promo
 * must never cover the store's primary CTA.
 */
function isQuietPath(pathname: string): boolean {
  return (
    pathname.startsWith("/account/cart") ||
    pathname.startsWith("/account/orders") ||
    pathname.startsWith("/account/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/p/") ||
    pathname.startsWith("/admin")
  );
}

/**
 * Due when BOTH gates pass: an explicit dismiss/click snoozes for the admin's
 * full frequency; a mere appearance only pauses a day (so glancing at it in
 * the browser doesn't hide it for a week in the installed app — on Android
 * the PWA shares this storage with the browser).
 */
function dueNow(frequencyDays: number): boolean {
  try {
    const seen = parseInt(window.localStorage.getItem(SHOWN_AT_KEY) ?? "0", 10) || 0;
    const acked = parseInt(window.localStorage.getItem(ACK_AT_KEY) ?? "0", 10) || 0;
    const now = Date.now();
    if (acked && now - acked < frequencyDays * 24 * 60 * 60 * 1000) return false;
    if (seen && now - seen < SEEN_SNOOZE_MS) return false;
    return true;
  } catch {
    return false;
  }
}

/** Record an explicit interaction (dismiss or click) — full-frequency snooze. */
function acknowledge() {
  try {
    window.localStorage.setItem(ACK_AT_KEY, String(Date.now()));
  } catch {
    /* private mode */
  }
}

export function SlabyPromoCard() {
  const config = useSlabyBranding();
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const [open, setOpen] = React.useState(false);

  const eligible = slabyPlacementOn(config, "promo") && !isQuietPath(pathname ?? "");

  React.useEffect(() => {
    if (!eligible) {
      // Scheduled (never sync in the effect body) per the repo's lint rule.
      const t = setTimeout(() => setOpen(false), 0);
      return () => clearTimeout(t);
    }
    if (!dueNow(config.promoFrequencyDays)) return;
    const timer = setTimeout(() => {
      // Re-check the path at fire time — the visitor may have navigated into
      // the cart while the delay ran.
      if (!isQuietPath(window.location.pathname)) {
        setOpen(true);
        try {
          window.localStorage.setItem(SHOWN_AT_KEY, String(Date.now()));
        } catch {
          /* private mode — the card simply shows again next visit */
        }
      }
    }, APPEAR_DELAY_MS);
    return () => clearTimeout(timer);
  }, [eligible, config.promoFrequencyDays]);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 300, damping: 26 }}
          aria-label="About the platform this store runs on"
          className="fixed right-4 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-border bg-card/95 p-4 shadow-lg backdrop-blur md:bottom-4"
        >
          <button
            type="button"
            onClick={() => {
              acknowledge();
              setOpen(false);
            }}
            aria-label="Dismiss"
            className="absolute top-2 right-2 grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <XIcon className="size-4" aria-hidden />
          </button>
          <div className="flex items-center gap-2 text-foreground">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#2563EB] text-white">
              <SlabyWordmark className="h-3" />
            </span>
            <p className="text-sm font-semibold">This store runs on Slaby</p>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Launch your own wholesale storefront — gated pricing, orders and
            billing, live in minutes.
          </p>
          <a
            href={slabyHref("promo")}
            target="_blank"
            rel="noopener noreferrer"
            onClick={acknowledge}
            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 dark:text-[#60A5FA]"
          >
            Explore Slaby
            <ArrowUpRight className="size-3.5" aria-hidden />
          </a>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
