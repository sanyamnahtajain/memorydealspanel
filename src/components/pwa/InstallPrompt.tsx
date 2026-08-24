"use client";

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { usePathname } from "next/navigation";
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
 * The storefront and the ADMIN panel are two separate PWAs (own manifests,
 * names, start URLs) — so install state, snooze state, copy and cadence are
 * per-variant. Without the split, a customer-storefront install on the same
 * browser profile would silently suppress the ADMIN install prompt forever
 * (the exact bug this fixes). The admin variant nags more often (owner
 * request): staff should run the installed app to get ringing order alerts.
 */
type InstallVariant = "storefront" | "admin";

interface VariantConfig {
  /** Home-screen app title in the prompt. */
  title: string;
  /** One-line pitch under the title (non-iOS). */
  body: string;
  /** Re-prompt cadence after a dismissal. */
  snoozeMs: number;
  installedKey: string;
  dismissKey: string;
  /** Which paths this variant lives on (each PWA has its own scope). */
  onPath: (pathname: string) => boolean;
}

const VARIANTS: Record<InstallVariant, VariantConfig> = {
  storefront: {
    title: "Install MemoryDeals",
    body: "Add it to your home screen for faster access.",
    snoozeMs: 4 * 60 * 60 * 1000, // 4h
    installedKey: "md-pwa-installed",
    dismissKey: "md-pwa-install-dismissed-at",
    onPath: (p) => !p.startsWith("/admin"),
  },
  admin: {
    title: "Install TMD Admin",
    body: "Order alerts ring loudest in the installed app — add it to this device.",
    snoozeMs: 2 * 60 * 60 * 1000, // 2h — staff should really install it
    installedKey: "md-pwa-admin-installed",
    dismissKey: "md-pwa-admin-dismissed-at",
    onPath: (p) => p.startsWith("/admin"),
  },
};

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
function isInstalled(cfg: VariantConfig): boolean {
  try {
    if (window.localStorage.getItem(cfg.installedKey) === "1") return true;
  } catch {
    /* ignore */
  }
  return isStandalone();
}

/** Milliseconds left on the current snooze, or 0 if not snoozed. */
function snoozeRemaining(cfg: VariantConfig): number {
  try {
    const raw = window.localStorage.getItem(cfg.dismissKey);
    const at = raw ? parseInt(raw, 10) : 0;
    if (!at) return 0;
    const remaining = at + cfg.snoozeMs - Date.now();
    return remaining > 0 ? remaining : 0;
  } catch {
    return 0;
  }
}

function markInstalled(cfg: VariantConfig) {
  try {
    window.localStorage.setItem(cfg.installedKey, "1");
  } catch {
    /* ignore */
  }
}

function markDismissedNow(cfg: VariantConfig) {
  try {
    window.localStorage.setItem(cfg.dismissKey, String(Date.now()));
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
 * - Dismissal snoozes per variant and then re-prompts, repeating until the app
 *   is installed; already-installed (standalone) sessions never see it.
 *
 * Token-styled; renders nothing until it has something to show. Safe on both
 * the light storefront and dark admin surfaces.
 */
/** No-op subscription — the client snapshot never changes after hydration. */
function subscribeNoop(): () => void {
  return () => {};
}

export function InstallPrompt({
  variant = "storefront",
  className,
}: {
  variant?: InstallVariant;
  className?: string;
}) {
  const cfg = VARIANTS[variant];
  const pathname = usePathname() ?? "/";
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
    () => typeof window !== "undefined" && isIos() && !isStandalone(),
  );
  const [snoozed, setSnoozed] = useState(() => {
    if (typeof window === "undefined") return true;
    return isInstalled(cfg) || snoozeRemaining(cfg) > 0;
  });

  // Re-show once the snooze window elapses, unless already installed. Runs in a
  // timeout/handler (never synchronously in an effect), so state updates stay
  // outside the effect body.
  const scheduleReshow = useCallback(
    (delay: number) => {
      return window.setTimeout(
        () => {
          if (!isInstalled(cfg)) setSnoozed(false);
        },
        Math.max(0, Math.min(delay, 2 ** 31 - 1)),
      );
    },
    [cfg],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isInstalled(cfg)) return; // permanently suppressed

    // If currently snoozed, arm a timer to reveal when the window elapses.
    const remaining = snoozeRemaining(cfg);
    const timer = remaining > 0 ? scheduleReshow(remaining) : undefined;

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setHasPrompt(true);
    };
    const onInstalled = () => {
      markInstalled(cfg);
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
  }, [cfg, scheduleReshow]);

  // Each variant only lives on its own PWA's paths (separate manifests).
  const onOwnSurface = cfg.onPath(pathname);
  const visible = mounted && onOwnSurface && !snoozed && (hasPrompt || iosHint);

  const snooze = useCallback(() => {
    markDismissedNow(cfg);
    setSnoozed(true);
    scheduleReshow(cfg.snoozeMs);
  }, [cfg, scheduleReshow]);

  const install = useCallback(async () => {
    if (!deferred) return;
    setHasPrompt(false);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") {
        markInstalled(cfg);
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
  }, [cfg, deferred, snooze]);

  if (!visible) return null;

  return (
    <AnimatePresence>
      <motion.div
        key={`pwa-install-${variant}`}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        role="dialog"
        aria-label={cfg.title}
        className={cn(
          "fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-sm items-start gap-3 rounded-xl border border-border bg-card p-3 text-card-foreground shadow-lg sm:inset-x-auto sm:right-4 sm:left-auto",
          className,
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <DownloadIcon className="size-4.5" aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{cfg.title}</p>
          {iosHint ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              Tap
              <ShareIcon className="inline size-3.5" aria-hidden />
              then &ldquo;Add to Home Screen&rdquo;.
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">{cfg.body}</p>
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
