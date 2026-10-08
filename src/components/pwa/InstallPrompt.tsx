"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ShareIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { hapticTap } from "@/lib/haptics";
import { useEngagement } from "@/components/notify/useEngagement";
import { useIsMobile } from "@/components/common/use-is-mobile";
import { useEntranceInitial } from "@/components/motion/useEntrance";
import { PressScale } from "@/components/motion/primitives";
import { InstallHelpSheet } from "@/components/pwa/InstallHelpSheet";
import {
  DESKTOP_AUTO_HIDE_MS,
  clearSnooze,
  isQuietPath,
  isSnoozed,
  snooze,
  type InstallVariant,
} from "@/components/pwa/install-snooze";

/**
 * The "add this app to your home screen" ask.
 *
 * PLACEMENT (the audit finding this fixes — a card pinned bottom-right over
 * content that never went away):
 *  - Phone (< 768px, the SAME breakpoint the tab bar hides at): a bottom
 *    SHEET that sits ABOVE the mobile tab bar (--md-tab-h + safe area), with the app icon, one line of value and two full
 *    width pills — Install / Not now. Never on pages that already own the
 *    bottom edge with a sticky CTA (see `isQuietPath`).
 *  - Desktop: a slim toast bottom-LEFT (CTAs live right/centre) that
 *    auto-hides after 12 s unless hovered.
 *  - Any dismissal — tap, X or auto-hide — parks it for 7 days on this device
 *    (localStorage, try/catch). Never shows when already installed or
 *    running standalone.
 *
 * The storefront and the ADMIN panel are two separate PWAs (own manifests,
 * names, start URLs) — so install state, copy and cadence are per-variant.
 *
 * WHEN it appears is decided by the shared usage algorithm in
 * `src/lib/notify/engagement.ts` (the same one that governs the notification
 * ask), AND by the 7-day snooze above. The algorithm waits until the person
 * has actually used the shop, then re-asks on a widening ladder.
 *
 * Platform behaviour:
 *  - Chromium: captures `beforeinstallprompt`, suppresses the default
 *    mini-bar, and the Install pill triggers the native prompt.
 *  - iOS Safari: no install event exists, so the sheet explains Share → Add to
 *    Home Screen and offers the full step-by-step {@link InstallHelpSheet}
 *    (which wraps `IosInstallGuide`). On iOS this matters twice over — web
 *    notifications do not work at all until the app is installed.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

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
  appName: string;
}

const VARIANTS: Record<InstallVariant, VariantConfig> = {
  storefront: {
    title: "Get the app",
    body: "One tap from your home screen — faster, and works offline.",
    iosBody: "Open it in one tap and get order updates on your phone.",
    installedKey: "md-pwa-installed",
    onPath: (p) => !p.startsWith("/admin"),
    appName: "The Memory Deals",
  },
  admin: {
    title: "Install TMD Admin",
    body: "Order alerts ring loudest in the installed app — add it to this device.",
    iosBody:
      "Add it to your home screen. On iPhone, order alerts only work in the installed app.",
    installedKey: "md-pwa-admin-installed",
    onPath: (p) => p.startsWith("/admin"),
    appName: "TMD Admin",
  },
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari
      (window.navigator as Navigator & { standalone?: boolean }).standalone ===
        true
    );
  } catch {
    return false;
  }
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

const SHEET_SPRING = { type: "spring", stiffness: 380, damping: 34, mass: 0.9 } as const;

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
  const reduced = useReducedMotion();
  // `md` breakpoint — the one the storefront tab bar hides at. The sheet /
  // toast split below is pure CSS at the same width; this only decides
  // whether the desktop auto-hide timer runs.
  const isPhone = useIsMobile();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [hasPrompt, setHasPrompt] = useState(false);
  const [visible, setVisible] = useState(false);
  const [hovering, setHovering] = useState(false);
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

  const entranceInitial = useEntranceInitial({ opacity: 0, y: 32 });

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
      clearSnooze(variant);
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
  }, [cfg, engagement, variant]);

  // Ask the algorithm whether this is a good moment.
  useEffect(() => {
    if (!mounted || !engagement.ready) return;
    if (askedRef.current) return;
    // Nothing installable to offer yet: no captured prompt and not iOS.
    if (!hasPrompt && !iosHint) return;
    if (isInstalled(cfg)) return;
    // A recent dismissal (tap, X or auto-hide) parks the ask for 7 days.
    if (isSnoozed(variant)) return;
    // Each variant only lives on its own PWA's paths (separate manifests), so
    // the admin card can never surface on a customer's storefront.
    if (!cfg.onPath(pathname)) return;
    // Never cover a page's own sticky call-to-action.
    if (isQuietPath(pathname)) return;

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
  }, [cfg, engagement, hasPrompt, iosHint, mounted, pathname, variant]);

  // Hide (and park for 7 days) without recording a decline — the auto-hide.
  const park = useCallback(() => {
    snooze(variant);
    setVisible(false);
  }, [variant]);

  // An explicit "no": park AND move the engagement ladder down a rung.
  const dismiss = useCallback(() => {
    engagement.markDeclined("install");
    snooze(variant);
    setVisible(false);
  }, [engagement, variant]);

  // Desktop toast: auto-hide after 12 s, paused while the pointer is over it.
  useEffect(() => {
    if (!visible || isPhone || hovering) return;
    const timer = window.setTimeout(park, DESKTOP_AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [visible, isPhone, hovering, park]);

  // If the route changes to a page that owns its bottom edge, step aside.
  useEffect(() => {
    if (!visible) return;
    if (isQuietPath(pathname) || !cfg.onPath(pathname)) {
      const t = window.setTimeout(park, 0);
      return () => window.clearTimeout(t);
    }
  }, [visible, pathname, cfg, park]);

  const install = useCallback(async () => {
    if (!deferred) return;
    hapticTap();
    setHasPrompt(false);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") {
        markInstalled(cfg);
        clearSnooze(variant);
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
  }, [cfg, deferred, dismiss, engagement, variant]);

  if (!mounted) return null;

  const titleId = `pwa-install-title-${variant}`;
  const bodyId = `pwa-install-body-${variant}`;
  const show = visible && cfg.onPath(pathname);

  // AnimatePresence stays mounted so the sheet can play its exit spring.
  return (
    <AnimatePresence>
      {show ? (
      <motion.div
        key={`pwa-install-${variant}`}
        initial={entranceInitial}
        animate={{ opacity: 1, y: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, y: 32 }}
        transition={reduced ? { duration: 0.12 } : SHEET_SPRING}
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocusCapture={() => setHovering(true)}
        onBlurCapture={() => setHovering(false)}
        className={cn(
          // Phone: a sheet docked just above the tab bar.
          "fixed inset-x-3 z-50 rounded-3xl bg-card p-4 text-card-foreground shadow-[0_18px_50px_-20px_rgb(0_0_0/0.35)] ring-1 ring-foreground/8",
          "bottom-[calc(var(--md-tab-h,3.5rem)+0.75rem+env(safe-area-inset-bottom))]",
          // Desktop: a slim toast bottom-left.
          "md:inset-x-auto md:bottom-4 md:left-4 md:w-[23rem] md:rounded-2xl md:p-3",
          className,
        )}
      >
        {/* Drag-handle affordance (phones only) — purely visual. */}
        <span
          aria-hidden
          className="absolute top-2 left-1/2 h-1 w-9 -translate-x-1/2 rounded-full bg-foreground/10 md:hidden"
        />

        <div className="flex items-start gap-3 pt-2 md:pt-0">
          <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-foreground/8 md:size-10 md:rounded-xl">
            <Image
              src="/icons/icon-192.png"
              alt=""
              width={48}
              height={48}
              className="size-10 object-contain md:size-8"
            />
          </span>

          <div className="min-w-0 flex-1">
            <p id={titleId} className="font-heading text-[15px] leading-tight font-semibold tracking-tight md:text-sm">
              {cfg.title}
            </p>
            <p id={bodyId} className="mt-1 text-[13px] leading-snug text-muted-foreground md:text-xs">
              {iosHint ? cfg.iosBody : cfg.body}
            </p>
            {iosHint ? (
              <p className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                Tap
                <span className="inline-flex size-5 items-center justify-center rounded-md bg-muted">
                  <ShareIcon className="size-3.5" aria-hidden />
                </span>
                then &ldquo;Add to Home Screen&rdquo;.
              </p>
            ) : null}
          </div>

          {/* Desktop inline actions: compact pill + X. */}
          <div className="hidden shrink-0 items-center gap-1 md:flex">
            {iosHint ? (
              <InstallHelpSheet
                variant={variant}
                appName={cfg.appName}
                trigger={
                  <button
                    type="button"
                    className="inline-flex h-8 items-center rounded-full bg-foreground px-3 text-xs font-semibold text-background outline-none transition-colors hover:bg-foreground/90 focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    How
                  </button>
                }
              />
            ) : (
              <button
                type="button"
                onClick={install}
                className="inline-flex h-8 items-center rounded-full bg-foreground px-3 text-xs font-semibold text-background outline-none transition-colors hover:bg-foreground/90 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Install
              </button>
            )}
            <button
              type="button"
              onClick={dismiss}
              aria-label="Not now"
              className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <XIcon className="size-4" aria-hidden />
            </button>
          </div>
        </div>

        {/* Phone actions: two full-width pills. */}
        <div className="mt-4 grid grid-cols-[1fr_1.4fr] gap-2 md:hidden">
          <PressScale
            type="button"
            onClick={dismiss}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-muted px-4 text-sm font-semibold text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Not now
          </PressScale>
          {iosHint ? (
            <InstallHelpSheet
              variant={variant}
              appName={cfg.appName}
              trigger={
                <PressScale
                  type="button"
                  haptic
                  className="inline-flex min-h-11 items-center justify-center rounded-full bg-foreground px-4 text-sm font-semibold text-background outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  Show me how
                </PressScale>
              }
            />
          ) : (
            <PressScale
              type="button"
              haptic
              onClick={install}
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-foreground px-4 text-sm font-semibold text-background outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Install
            </PressScale>
          )}
        </div>
      </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export default InstallPrompt;
