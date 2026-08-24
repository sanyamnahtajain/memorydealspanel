"use client";

import * as React from "react";
import { toast } from "sonner";
import { CheckIcon, CopyIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * "Add to Home Screen", explained so a first-time iPhone user can finish it.
 *
 * Apple gives the web no install API — there is no button we can press on the
 * user's behalf, and pretending otherwise is how people end up stuck. So the
 * steps stay exactly as many as iOS requires; what we can do is make each one
 * impossible to miss: a drawn copy of the Share glyph they must hunt for, the
 * exact place it sits on iPhone versus iPad, and the words that appear on
 * screen at each tap.
 *
 * THE ONE THING THAT BREAKS PEOPLE: on iOS only **Safari** can add a site to
 * the home screen. Chrome, Firefox and every in-app browser (Instagram,
 * WhatsApp, Facebook) simply have no such menu item, so a customer follows the
 * steps, finds nothing, and concludes the shop is broken. We detect that case
 * and put "open this in Safari first" ahead of everything else, with a Copy
 * link button so they can paste it over.
 *
 * The small platform helpers below are deliberate copies of the ones in
 * `InstallPrompt.tsx` — that file does not export them, and importing from a
 * component module purely for two regexes would tie this guide's lifetime to
 * that card's. Keep the two in step if the detection ever changes.
 */

/* ------------------------------------------------------------------ */
/* platform detection                                                  */
/* ------------------------------------------------------------------ */

/** Already opened from the home screen (or any standalone display mode). */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's own flag, which predates display-mode.
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true
  );
}

/** iPhone / iPad / iPod, including iPadOS 13+ which lies and says "Macintosh". */
export function isIosDevice(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  return /macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

/** True for an iPad (the Share button lives somewhere else there). */
function isIpad(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  return /ipad/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

export type IosBrowser = "safari" | "chrome" | "firefox" | "edge" | "in-app";

/**
 * Which browser this iOS user is really in. Every iOS browser renders with
 * WebKit and most keep "Safari" in the user agent, so the only reliable
 * signal is the vendor tag each one appends.
 */
export function detectIosBrowser(): IosBrowser {
  if (typeof window === "undefined") return "safari";
  const ua = window.navigator.userAgent;
  if (/CriOS/i.test(ua)) return "chrome";
  if (/FxiOS/i.test(ua)) return "firefox";
  if (/EdgiOS/i.test(ua)) return "edge";
  // In-app web views: Instagram, Facebook/Messenger, Line, Snapchat, and the
  // generic "no Safari tag at all" WKWebView that UPI and chat apps embed.
  if (/Instagram|FBAN|FBAV|FB_IAB|Line\/|Snapchat|Twitter|MicroMessenger|GSA\//i.test(ua)) {
    return "in-app";
  }
  if (/iphone|ipad|ipod/i.test(ua) && !/Safari/i.test(ua)) return "in-app";
  return "safari";
}

const BROWSER_NAME: Record<IosBrowser, string> = {
  safari: "Safari",
  chrome: "Chrome",
  firefox: "Firefox",
  edge: "Edge",
  "in-app": "this app",
};

/* ------------------------------------------------------------------ */
/* drawings                                                            */
/* ------------------------------------------------------------------ */

/**
 * The iOS Share glyph: a box open at the top with an arrow rising out of it.
 * Drawn rather than described, because the whole trick is letting the user
 * match a shape on their own screen. Sized to sit inline in a sentence.
 */
export function IosShareGlyph({
  className,
  ...props
}: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={cn("inline-block size-4.5 align-[-0.25em]", className)}
      {...props}
    >
      {/* box, deliberately open across the top so the arrow can leave it */}
      <path
        d="M9 10H6.75A1.75 1.75 0 0 0 5 11.75v7.5A1.75 1.75 0 0 0 6.75 21h10.5A1.75 1.75 0 0 0 19 19.25v-7.5A1.75 1.75 0 0 0 17.25 10H15"
        className="fill-primary/10 stroke-primary"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* arrow */}
      <path
        d="M12 14.5V3.6"
        className="stroke-primary"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M8.4 7.2 12 3.6l3.6 3.6"
        className="stroke-primary"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The "+" in a rounded square that iOS shows next to "Add to Home Screen". */
function AddToHomeGlyph({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={cn("inline-block size-4.5 align-[-0.25em]", className)}
      {...props}
    >
      <rect
        x="3.5"
        y="3.5"
        width="17"
        height="17"
        rx="5"
        className="fill-primary/10 stroke-primary"
        strokeWidth="1.8"
      />
      <path
        d="M12 8v8M8 12h8"
        className="stroke-primary"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * A phone with the Safari toolbar drawn along the bottom and the Share button
 * ringed — the picture answers "where is that button?" before the words do.
 */
function SafariToolbarIllustration(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 148 130"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...props}
    >
      {/* ground */}
      <path
        d="M10 126h96"
        className="stroke-border"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="1 7"
      />
      {/* phone */}
      <rect
        x="18"
        y="4"
        width="80"
        height="116"
        rx="12"
        className="fill-card stroke-muted-foreground"
        strokeWidth="2"
      />
      {/* notch */}
      <path
        d="M48 10h20"
        className="stroke-muted-foreground"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* page */}
      <rect x="25" y="17" width="66" height="57" rx="4" className="fill-muted" />
      <path
        d="M32 29h28M32 38h42M32 47h36M32 56h22"
        className="stroke-muted-foreground/35"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* address bar */}
      <rect x="29" y="78" width="58" height="11" rx="5.5" className="fill-muted" />
      <path
        d="M40 83.5h30"
        className="stroke-muted-foreground/40"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* the Safari toolbar, along the bottom of the screen */}
      <rect x="25" y="94" width="66" height="18" rx="5" className="fill-muted" />
      {/* back / forward */}
      <path
        d="M34 99.5 31.5 103l2.5 3.5M40 99.5 42.5 103 40 106.5"
        className="stroke-muted-foreground/60"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* bookmarks / tabs */}
      <path
        d="M74 99h5v8l-2.5-2-2.5 2z"
        className="stroke-muted-foreground/60"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <rect
        x="83"
        y="99.5"
        width="5.5"
        height="6.5"
        rx="1"
        className="stroke-muted-foreground/60"
        strokeWidth="1.6"
      />
      {/* Share — the one button this whole guide is about */}
      <path
        d="M55.5 101H54a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 54 110h8a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 62 101h-1.5"
        className="fill-primary/10 stroke-primary"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M58 105.5V96.5"
        className="stroke-primary"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M55.6 98.9 58 96.5l2.4 2.4"
        className="stroke-primary"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* highlight ring */}
      <circle
        cx="58"
        cy="103"
        r="11.5"
        className="stroke-primary"
        strokeWidth="2"
        strokeDasharray="4 4"
      />
      {/* pointer, curving in from the outside */}
      <path
        d="M138 110c-14 10-36 12-54 8"
        className="stroke-primary/70"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M88.5 113.2 83.5 118l5.5 3"
        className="stroke-primary/70"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* sparkles */}
      <path
        d="M118 34v8M114 38h8M130 62l4 4M134 62l-4 4"
        className="stroke-primary/50"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="114" cy="86" r="2.5" className="fill-primary/40" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* "you are not in Safari" rescue                                      */
/* ------------------------------------------------------------------ */

function OpenInSafariNotice({ browser }: { browser: IosBrowser }) {
  const [copying, setCopying] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  // Only filled in when the clipboard refuses — then the address is shown so
  // the user can select and copy it by hand.
  const [fallbackUrl, setFallbackUrl] = React.useState<string | null>(null);

  const copyLink = React.useCallback(async () => {
    const href = window.location.href;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setFallbackUrl(null);
      toast.success("Link copied. Now open Safari and paste it.");
    } catch {
      // Clipboard blocked (common inside in-app browsers). Show the address
      // instead of failing silently.
      setCopied(false);
      setFallbackUrl(href);
    } finally {
      setCopying(false);
    }
  }, []);

  return (
    <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3">
      <p className="text-sm font-semibold text-foreground">
        Open this page in Safari first
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        You are in {BROWSER_NAME[browser]}. Only Safari can add this shop to
        your home screen. Copy the link, open Safari, paste it, then follow the
        steps below.
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={copyLink} disabled={copying}>
          {copying ? (
            <Spinner size="xs" label="" />
          ) : copied ? (
            <CheckIcon aria-hidden />
          ) : (
            <CopyIcon aria-hidden />
          )}
          {copied ? "Link copied" : "Copy link"}
        </Button>
        {copied ? (
          <span className="text-xs text-muted-foreground">
            Now open Safari and paste it.
          </span>
        ) : null}
      </div>

      {fallbackUrl ? (
        <div className="mt-2.5">
          <p className="text-xs text-muted-foreground">
            Copying did not work here. Press and hold the address below to copy
            it:
          </p>
          <p className="mt-1 rounded-lg border border-border bg-card px-2 py-1.5 text-xs break-all text-foreground select-all">
            {fallbackUrl}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the guide                                                           */
/* ------------------------------------------------------------------ */

function Step({
  index,
  children,
}: {
  index: number;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        aria-hidden
        className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary/12 text-xs font-semibold text-primary"
      >
        {index}
      </span>
      <span className="min-w-0 flex-1 text-sm leading-relaxed text-foreground">
        {children}
      </span>
    </li>
  );
}

/** No-op subscription — the "we are on the client" flag never changes. */
function subscribeNoop(): () => void {
  return () => {};
}

export interface IosInstallGuideProps {
  className?: string;
  /** Hide the phone drawing when space is tight (inline in a small card). */
  showIllustration?: boolean;
  /** App name shown in the last step. */
  appName?: string;
}

/**
 * The full add-to-home-screen guide. Safe to drop inline in a card or inside
 * a sheet — it brings no surface of its own.
 */
export function IosInstallGuide({
  className,
  showIllustration = true,
  appName = "The Memory Deals",
}: IosInstallGuideProps) {
  // `false` on the server and on the first client paint, `true` after — so the
  // browser-specific notice can never cause a hydration mismatch.
  const mounted = React.useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  // Read once, lazily, on the client. Only consulted after `mounted`.
  const [browser] = React.useState<IosBrowser>(() =>
    typeof window === "undefined" ? "safari" : detectIosBrowser(),
  );
  const [ipad] = React.useState(() => isIpad());

  const wrongBrowser = mounted && browser !== "safari";

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {wrongBrowser ? <OpenInSafariNotice browser={browser} /> : null}

      {showIllustration && !wrongBrowser ? (
        <SafariToolbarIllustration className="mx-auto h-32 w-auto" />
      ) : null}

      <ol className="flex flex-col gap-2.5">
        <Step index={1}>
          Tap the Share button <IosShareGlyph /> in Safari.{" "}
          <span className="text-muted-foreground">
            {/* The narrowed iPad wording only after mount — before that the
                sentence that covers both devices, so the first client paint
                still matches the server's. */}
            {mounted && ipad
              ? "On iPad it is at the top right of the screen."
              : "On iPhone it is at the bottom of the screen; on iPad it is at the top right."}
          </span>
        </Step>
        <Step index={2}>
          Scroll down the list and tap{" "}
          <span className="font-medium">Add to Home Screen</span>{" "}
          <AddToHomeGlyph />.
        </Step>
        <Step index={3}>
          Tap <span className="font-medium">Add</span> at the top right.
        </Step>
        <Step index={4}>
          Open {appName} from your home screen from now on.
        </Step>
      </ol>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Only Safari can do this on iPhone and iPad. It takes about ten seconds
        and uses almost no space.
      </p>
    </div>
  );
}

export default IosInstallGuide;
