"use client";

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { DownloadIcon, ShareIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The (not-yet-standardised) `beforeinstallprompt` event. Typed locally
 * because it's absent from the DOM lib.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

/**
 * Re-prompt cadence: a dismissal ("Not now" / ✕ / declining the native sheet)
 * only SNOOZES the prompt for this long. It reappears after the window elapses
 * (on the next visit, or live if the tab stays open) and keeps nudging every
 * 4 hours — UNTIL the app is actually installed, after which it never shows
 * again.
 */
const SNOOZE_MS = 4 * 60 * 60 * 1000; // 4 hours
/** Epoch-ms of the last dismissal (drives the snooze window). */
const DISMISS_AT_KEY = "md-pwa-install-dismissed-at";
/** Set once installed → the prompt is suppressed permanently. */
const INSTALLED_KEY = "md-pwa-installed";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true
  );
}

function isIos(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const isIosDevice = /iphone|ipad|ipod/i.test(ua);
  // iPadOS 13+ reports as Mac; detect via touch support.
  const isIpadOs = /macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  return isIosDevice || isIpadOs;
}

/** Installed for good — a stored flag or an already-standalone session. */
function isInstalled(): boolean {
  try {
    if (window.localStorage.getItem(INSTALLED_KEY) === "1") return true;
  } catch {
    /* ignore */
  }
  return isStandalone();
}

/** Milliseconds left on the current snooze, or 0 if not snoozed. */
function snoozeRemaining(): number {
  try {
    const raw = window.localStorage.getItem(DISMISS_AT_KEY);
    const at = raw ? parseInt(raw, 10) : 0;
    if (!at) return 0;
    const remaining = at + SNOOZE_MS - Date.now();
    return remaining > 0 ? remaining : 0;
  } catch {
    return 0;
  }
}

function markInstalled() {
  try {
    window.localStorage.setItem(INSTALLED_KEY, "1");
  } catch {
    /* ignore */
  }
}

function markDismissedNow() {
  try {
    window.localStorage.setItem(DISMISS_AT_KEY, String(Date.now()));
  } catch {
    /* ignore — snooze simply won't persist across reloads. */
  }
}

/**
 * Subtle, dismissible "Install app" affordance.
 *
 * - Chromium: captures `beforeinstallprompt`, suppresses the default mini-bar,
 *   and shows a custom card whose CTA triggers the native prompt.
 * - iOS Safari: no install event exists, so shows an Add-to-Home-Screen hint.
 * - Dismissal snoozes for 4h and then re-prompts, repeating until the app is
 *   installed; already-installed (standalone) sessions never see it.
 *
 * Token-styled; renders nothing until it has something to show. Safe on both
 * the light storefront and dark admin surfaces.
 */
/** No-op subscription — the client snapshot never changes after hydration. */
function subscribeNoop(): () => void {
  return () => {};
}

export function InstallPrompt({ className }: { className?: string }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [hasPrompt, setHasPrompt] = useState(false);

  // Client-mounted gate: `false` on the server and the first client paint (so
  // we render `null` and hydration matches), `true` thereafter — no
  // setState-in-effect needed to reveal.
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  // Lazily computed from client state; only ever consulted once `mounted`, so
  // an SSR/CSR difference can't cause a hydration mismatch.
  const [iosHint] = useState(
    () =>
      typeof window !== "undefined" && isIos() && !isStandalone(),
  );
  const [snoozed, setSnoozed] = useState(() => {
    if (typeof window === "undefined") return true;
    return isInstalled() || snoozeRemaining() > 0;
  });

  // Re-show once the snooze window elapses, unless already installed. Runs in a
  // timeout/handler (never synchronously in an effect), so state updates stay
  // outside the effect body.
  const scheduleReshow = useCallback((delay: number) => {
    return window.setTimeout(
      () => {
        if (!isInstalled()) setSnoozed(false);
      },
      Math.max(0, Math.min(delay, 2 ** 31 - 1)),
    );
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isInstalled()) return; // permanently suppressed

    // If currently snoozed, arm a timer to reveal when the window elapses.
    const remaining = snoozeRemaining();
    const timer = remaining > 0 ? scheduleReshow(remaining) : undefined;

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setHasPrompt(true);
    };
    const onInstalled = () => {
      markInstalled();
      setHasPrompt(false);
      setDeferred(null);
      setSnoozed(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [scheduleReshow]);

  const visible = mounted && !snoozed && (hasPrompt || iosHint);

  const snooze = useCallback(() => {
    markDismissedNow();
    setSnoozed(true);
    scheduleReshow(SNOOZE_MS);
  }, [scheduleReshow]);

  const install = useCallback(async () => {
    if (!deferred) return;
    setHasPrompt(false);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") {
        markInstalled();
        setSnoozed(true);
        return;
      }
      // Declined the native sheet → snooze like a dismissal.
      snooze();
    } catch {
      snooze();
    } finally {
      setDeferred(null);
    }
  }, [deferred, snooze]);

  if (!visible) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="pwa-install"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        role="dialog"
        aria-label="Install MemoryDeals"
        className={cn(
          "fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-sm items-start gap-3 rounded-xl border border-border bg-card p-3 text-card-foreground shadow-lg sm:inset-x-auto sm:right-4 sm:left-auto",
          className,
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <DownloadIcon className="size-4.5" aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Install MemoryDeals</p>
          {iosHint ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              Tap
              <ShareIcon className="inline size-3.5" aria-hidden />
              then &ldquo;Add to Home Screen&rdquo;.
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Add it to your home screen for faster access.
            </p>
          )}

          {!iosHint ? (
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" onClick={install}>
                Install app
              </Button>
              <Button size="sm" variant="ghost" onClick={snooze}>
                Not now
              </Button>
            </div>
          ) : null}
        </div>

        <Button
          size="icon-sm"
          variant="ghost"
          onClick={snooze}
          aria-label="Dismiss install prompt"
          className="-mt-0.5 -mr-0.5 shrink-0"
        >
          <XIcon className="size-4" aria-hidden />
        </Button>
      </motion.div>
    </AnimatePresence>
  );
}

export default InstallPrompt;
