"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { BellRing, Loader2, SettingsIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useEngagement } from "./useEngagement";
import { usePushSubscription } from "./usePushSubscription";

/**
 * The notification ask — shown only when the usage algorithm says the moment
 * is right (see `src/lib/notify/engagement.ts` for every rule).
 *
 * The owner's complaint this answers: people decline the permission once and
 * are then never asked again, so they miss their order updates and staff miss
 * orders. The fix is not to ask harder, it is to ask LATER and BETTER —
 * after the person has shown they use the shop, at a moment that is not
 * checkout, with a reason stated in words they can act on.
 *
 * Two modes:
 *   - "prompt" — we can still raise the browser's permission dialog, so the
 *     button does exactly that.
 *   - "howto"  — the user hard-denied permission, which no script can undo.
 *     We stop asking and explain where the switch lives instead.
 *
 * Nothing here is ever shown twice in a visit, and never over the cart or the
 * sign-in flow.
 */

interface VariantCopy {
  title: string;
  body: string;
  confirm: string;
  dismiss: string;
  howtoTitle: string;
  howtoBody: string;
}

const COPY: Record<"storefront" | "admin", VariantCopy> = {
  storefront: {
    title: "Get order updates",
    body: "We will tell you when your order is confirmed and before your prices end. Nothing else.",
    confirm: "Yes, tell me",
    dismiss: "Not now",
    howtoTitle: "Alerts are switched off",
    howtoBody:
      "Your browser is blocking alerts for this shop. Tap the lock icon near the web address, then allow alerts.",
  },
  admin: {
    title: "Turn on order alerts",
    body: "This device will ring when a new order or a new request comes in.",
    confirm: "Turn on alerts",
    dismiss: "Later",
    howtoTitle: "Alerts are blocked",
    howtoBody:
      "This browser is blocking alerts. Open the lock icon near the web address and allow notifications, then tap Check again.",
  },
};

/** A friendly bell, drawn in the same minimal style as the empty states. */
function BellIllustration(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden {...props}>
      <path
        d="M24 8a10 10 0 0 1 10 10v7l3 5a1.5 1.5 0 0 1-1.3 2.3H12.3A1.5 1.5 0 0 1 11 30l3-5v-7A10 10 0 0 1 24 8Z"
        className="fill-primary/12 stroke-primary"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M20 36a4 4 0 0 0 8 0"
        className="stroke-primary"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M24 4v3" className="stroke-primary" strokeWidth="2" strokeLinecap="round" />
      {/* sound waves */}
      <path
        d="M38 14a12 12 0 0 1 3 7M10 14a12 12 0 0 0-3 7"
        className="stroke-primary/50"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function NotifyGate({
  variant = "storefront",
  className,
}: {
  variant?: "storefront" | "admin";
  className?: string;
}) {
  const copy = COPY[variant];
  // Staff and buyers keep separate usage ledgers — see useEngagement.
  const engagement = useEngagement(variant);
  const push = usePushSubscription();
  const [visible, setVisible] = React.useState(false);
  const [mode, setMode] = React.useState<"prompt" | "howto">("prompt");
  const askedRef = React.useRef(false);

  const installed =
    push.status !== "needs-install" && !push.iosNeedsInstall
      ? true
      : // On iOS "installed" is exactly "running standalone".
        typeof window !== "undefined" &&
        window.matchMedia("(display-mode: standalone)").matches;

  React.useEffect(() => {
    if (!engagement.ready) return;
    if (push.status === "checking") return;
    if (askedRef.current) return;

    // Nothing to ask for: already on, or this browser genuinely cannot.
    if (push.status === "on" || push.status === "unsupported" || push.status === "unconfigured") {
      return;
    }

    // The install prompt takes priority whenever it is also due — on iOS
    // notifications are impossible without it, and elsewhere two cards in one
    // visit is one card too many.
    const installDue = engagement.decide("install", {
      installed,
      permission: push.permission,
      iosNeedsInstall: push.iosNeedsInstall,
    });
    if (installDue.ask) return;

    const decision = engagement.decide("notify", {
      installed,
      permission: push.permission,
      iosNeedsInstall: push.iosNeedsInstall,
    });
    if (!decision.ask) return;

    askedRef.current = true;
    // A short delay keeps the card from landing during the first paint, when
    // the user is still reading the page they came for. Every state update
    // happens in the timer, never synchronously in the effect body.
    const timer = window.setTimeout(() => {
      setMode(decision.mode);
      setVisible(true);
      engagement.markAsked("notify");
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [engagement, installed, push.iosNeedsInstall, push.permission, push.status]);

  const accept = React.useCallback(async () => {
    const granted = await push.enable();
    if (granted) {
      engagement.markSatisfied("notify");
      setVisible(false);
      return;
    }
    // Declined at the browser dialog (or it failed) — treat it as a "no" and
    // let the backoff ladder decide when to try again.
    engagement.markDeclined("notify");
    setVisible(false);
  }, [engagement, push]);

  const decline = React.useCallback(() => {
    engagement.markDeclined("notify");
    setVisible(false);
  }, [engagement]);

  const recheck = React.useCallback(() => {
    push.refresh();
    setVisible(false);
  }, [push]);

  if (!visible) return null;

  const howto = mode === "howto";

  return (
    <AnimatePresence>
      <motion.div
        key="notify-gate"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 14 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        role="dialog"
        aria-label={howto ? copy.howtoTitle : copy.title}
        className={cn(
          // Sits above the storefront's fixed bottom bars on a phone.
          "fixed inset-x-3 bottom-20 z-50 mx-auto flex max-w-sm items-start gap-3 rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-lg ring-1 ring-foreground/5 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:left-auto",
          className,
        )}
      >
        <span className="shrink-0">
          {howto ? (
            <span className="grid size-10 place-items-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-300">
              <SettingsIcon className="size-5" aria-hidden />
            </span>
          ) : (
            <BellIllustration className="size-11" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {howto ? copy.howtoTitle : copy.title}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {howto ? copy.howtoBody : copy.body}
          </p>

          {push.error ? (
            <p
              role="alert"
              className="mt-2 rounded-lg bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
            >
              {push.error}
            </p>
          ) : null}

          <div className="mt-2.5 flex items-center gap-2">
            {howto ? (
              <Button size="sm" onClick={recheck}>
                Check again
              </Button>
            ) : (
              <Button size="sm" onClick={accept} disabled={push.busy}>
                {push.busy ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <BellRing className="size-3.5" aria-hidden />
                )}
                {copy.confirm}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={decline} disabled={push.busy}>
              {copy.dismiss}
            </Button>
          </div>
        </div>

        <Button
          size="icon-sm"
          variant="ghost"
          onClick={decline}
          aria-label="Close"
          className="-mt-1 -mr-1 shrink-0"
        >
          <XIcon className="size-4" aria-hidden />
        </Button>
      </motion.div>
    </AnimatePresence>
  );
}

export default NotifyGate;
