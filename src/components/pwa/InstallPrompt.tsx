"use client";

import { useCallback, useEffect, useState } from "react";
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

const DISMISS_KEY = "md-pwa-install-dismissed";

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
  const isIpadOs =
    /macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  return isIosDevice || isIpadOs;
}

/**
 * Subtle, dismissible "Install app" affordance.
 *
 * - Chromium: captures `beforeinstallprompt`, suppresses the default mini-bar,
 *   and shows a custom card whose CTA triggers the native prompt.
 * - iOS Safari: no install event exists, so shows an Add-to-Home-Screen hint.
 * - Dismissal is remembered in localStorage; already-installed (standalone)
 *   sessions never see it.
 *
 * Token-styled; renders nothing until it has something to show. Safe on both
 * the light storefront and dark admin surfaces.
 */
function isDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    // localStorage may be unavailable (private mode) — treat as not dismissed.
    return false;
  }
}

// Whether the iOS Add-to-Home-Screen hint should show. Evaluated lazily
// (client-only) so no state is set synchronously inside an effect.
function initialIosHint(): boolean {
  if (typeof window === "undefined") return false;
  return isIos() && !isStandalone() && !isDismissed();
}

export function InstallPrompt({ className }: { className?: string }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [iosHint] = useState(initialIosHint);
  // Visible when we either have a captured install event or an iOS hint.
  const [hasPrompt, setHasPrompt] = useState(false);
  const [dismissedState, setDismissedState] = useState(false);

  const visible = !dismissedState && (hasPrompt || iosHint);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandalone() || isDismissed()) return;

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setHasPrompt(true);
    };

    const onInstalled = () => {
      setHasPrompt(false);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const remember = useCallback(() => {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore — dismissal simply won't persist across reloads.
    }
  }, []);

  const dismiss = useCallback(() => {
    setDismissedState(true);
    remember();
  }, [remember]);

  const install = useCallback(async () => {
    if (!deferred) return;
    setHasPrompt(false);
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      // User dismissed the native sheet or it failed — nothing to do.
    } finally {
      setDeferred(null);
      remember();
    }
  }, [deferred, remember]);

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
              <Button size="sm" variant="ghost" onClick={dismiss}>
                Not now
              </Button>
            </div>
          ) : null}
        </div>

        <Button
          size="icon-sm"
          variant="ghost"
          onClick={dismiss}
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
