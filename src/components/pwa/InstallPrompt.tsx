"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { DownloadIcon, ShareIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEngagement } from "@/components/notify/useEngagement";

/**
 * The "add this app to your home screen" card.
 *
 * The storefront and the ADMIN panel are two separate PWAs (own manifests,
 * names, start URLs) — so install state, copy and cadence are per-variant.
 * Without the split, a customer-storefront install on the same browser profile
 * would silently suppress the ADMIN install prompt forever.
 *
 * WHEN it appears is no longer a fixed snooze timer. It is decided by the
 * shared usage algorithm in `src/lib/notify/engagement.ts`, the same one that
 * governs the notification ask — because the owner's complaint was precisely
 * that a single skipped prompt meant the user was effectively never asked
 * again. The algorithm waits until the person has actually used the shop,
 * then re-asks on a widening ladder (3d, 7d, 21d, 45d, 90d) that never gives
 * up entirely, and it guarantees at most one interruption per visit across
 * both prompts.
 *
 * Platform behaviour is unchanged:
 *  - Chromium: captures `beforeinstallprompt`, suppresses the default
 *    mini-bar, and shows this card whose CTA triggers the native prompt.
 *  - iOS Safari: no install event exists, so we show an Add-to-Home-Screen
 *    hint. On iOS this card matters twice over — web notifications do not
 *    work at all until the app is installed.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

type InstallVariant = "storefront" | "admin";

interface VariantConfig {
  /** Home-screen app title in the prompt. */
  title: string;
  /** One-line pitch under the title (non-iOS). */
  body: string;
  /** Extra line shown on iOS, where install also unlocks alerts. */
  iosBody: string;
  installedKey: string;
  /** Which paths this variant lives on (each PWA has its own scope). */
  onPath: (pathname: string) => boolean;
}

const VARIANTS: Record<InstallVariant, VariantConfig> = {
  storefront: {
    title: "Install MemoryDeals",
    body: "Add it to your home screen for faster access.",
    iosBody:
      "Add it to your home screen to open it faster and get order updates.",
    installedKey: "md-pwa-installed",
    onPath: (p) => !p.startsWith("/admin"),
  },
  admin: {
    title: "Install TMD Admin",
    body: "Order alerts ring loudest in the installed app — add it to this device.",
    iosBody:
      "Add it to your home screen. On iPhone, order alerts only work in the installed app.",
    installedKey: "md-pwa-admin-installed",
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

function markInstalled(cfg: VariantConfig) {
  try {
    window.localStorage.setItem(cfg.installedKey, "1");
  } catch {
    /* ignore */
  }
}

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
  const engagement = useEngagement(variant);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [hasPrompt, setHasPrompt] = useState(false);
  const [visible, setVisible] = useState(false);
  const askedRef = useRef(false);

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

  // Listen for the platform's install signals.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isInstalled(cfg)) return; // permanently suppressed

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setHasPrompt(true);
    };
    const onInstalled = () => {
      markInstalled(cfg);
      setHasPrompt(false);
      setDeferred(null);
      setVisible(false);
      engagement.markSatisfied("install");
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [cfg, engagement]);

  // Ask the algorithm whether this is a good moment.
  useEffect(() => {
    if (!mounted || !engagement.ready) return;
    if (askedRef.current) return;
    // Nothing installable to offer yet: no captured prompt and not iOS.
    if (!hasPrompt && !iosHint) return;
    if (isInstalled(cfg)) return;
    // Each variant only lives on its own PWA's paths (separate manifests), so
    // the admin card can never surface on a customer's storefront.
    if (!cfg.onPath(pathname)) return;

    const decision = engagement.decide("install", {
      installed: false,
      // Install is a platform prompt, not a permission one — these two fields
      // only matter to the "notify" branch of the algorithm.
      permission: "default",
      iosNeedsInstall: iosHint,
    });
    if (!decision.ask) return;

    askedRef.current = true;
    const timer = window.setTimeout(() => {
      setVisible(true);
      engagement.markAsked("install");
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [cfg, engagement, hasPrompt, iosHint, mounted, pathname]);

  const dismiss = useCallback(() => {
    engagement.markDeclined("install");
    setVisible(false);
  }, [engagement]);

  const install = useCallback(async () => {
    if (!deferred) return;
    setHasPrompt(false);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") {
        markInstalled(cfg);
        engagement.markSatisfied("install");
        setVisible(false);
        return;
      }
      // Declined the native sheet → the same as dismissing this card.
      dismiss();
    } catch {
      dismiss();
    } finally {
      setDeferred(null);
    }
  }, [cfg, deferred, dismiss, engagement]);

  if (!mounted || !visible || !cfg.onPath(pathname)) return null;

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
            <>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {cfg.iosBody}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                Tap
                <ShareIcon className="inline size-3.5" aria-hidden />
                then &ldquo;Add to Home Screen&rdquo;.
              </p>
            </>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">{cfg.body}</p>
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
