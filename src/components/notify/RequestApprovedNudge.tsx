"use client";

import * as React from "react";
import { BellRingIcon, CheckCircle2Icon, SmartphoneIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { InstallHelpSheet } from "@/components/pwa/InstallHelpSheet";
import { isIosDevice } from "@/components/pwa/IosInstallGuide";
import { useEngagement } from "./useEngagement";
import { usePushSubscription } from "./usePushSubscription";

/**
 * The ask, at the one moment it is welcome: the customer has just asked for
 * price access and is sitting on the "we will review it" screen, wanting to
 * know when the answer comes. So we do not ask them to "enable notifications" —
 * we offer them the answer: *we will tell you the moment it is approved*.
 *
 * This is deliberately NOT the ambient `NotifyGate`. That card waits for the
 * usage algorithm to pick a calm moment; this one is a reply to something the
 * user just did, so it appears immediately and inline. It still feeds the same
 * shared ledger — requesting access is recorded as a real action, and a "yes"
 * here permanently retires the ambient ask.
 *
 * Every platform dead end is handled instead of being papered over:
 *   - iPhone in a browser tab → alerts are impossible until the app is on the
 *     home screen, so we show that path and say so plainly.
 *   - alerts blocked in browser settings → no script can undo it, so we
 *     explain where the switch is and offer "Check again".
 *   - alerts genuinely unsupported → we render nothing at all.
 */

/** A bell in the same minimal style as the empty-state illustrations. */
function BellGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...props}
    >
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
      <path
        d="M24 4v3"
        className="stroke-primary"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M38 14a12 12 0 0 1 3 7M10 14a12 12 0 0 0-3 7"
        className="stroke-primary/50"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Shell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-full rounded-xl border border-border bg-muted/40 p-3 text-left",
        className,
      )}
    >
      {children}
    </div>
  );
}

const HEADLINE = "We will tell you the moment it is approved.";

export interface RequestApprovedNudgeProps {
  className?: string;
}

export function RequestApprovedNudge({ className }: RequestApprovedNudgeProps) {
  const push = usePushSubscription();
  const engagement = useEngagement("storefront");
  const { markAction, markSatisfied } = engagement;

  const [justEnabled, setJustEnabled] = React.useState(false);
  const actionRef = React.useRef(false);

  const [ios] = React.useState(() => isIosDevice());

  // Asking for prices is a real action — the shared re-ask algorithm should
  // count it. This writes to the engagement store, never to local state.
  React.useEffect(() => {
    if (actionRef.current) return;
    actionRef.current = true;
    markAction();
  }, [markAction]);

  const enable = React.useCallback(async () => {
    const granted = await push.enable();
    if (granted) {
      markSatisfied("notify");
      setJustEnabled(true);
    }
  }, [markSatisfied, push]);

  // Nothing we could offer would work here — better silence than a dead button.
  if (push.status === "unsupported" || push.status === "unconfigured") {
    return null;
  }

  /* ---------- already on, or just turned on ---------- */

  if (justEnabled || push.status === "on") {
    return (
      <Shell className={className}>
        <div className="flex items-start gap-2.5">
          <CheckCircle2Icon
            className="mt-0.5 size-5 shrink-0 text-success"
            aria-hidden
          />
          <p className="text-sm text-foreground">
            {justEnabled
              ? "Done — we will tell you."
              : "Alerts are on. We will tell you the moment it is approved."}
          </p>
        </div>
      </Shell>
    );
  }

  /* ---------- still checking this device ---------- */

  if (push.status === "checking") {
    return (
      <Shell className={className}>
        <div className="flex items-start gap-3">
          <BellGlyph className="size-9 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{HEADLINE}</p>
            <Button size="sm" disabled className="mt-2">
              <Spinner size="xs" label="" />
              Checking…
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  /* ---------- iPhone in a browser tab ---------- */

  if (push.status === "needs-install") {
    return (
      <Shell className={className}>
        <div className="flex items-start gap-3">
          <BellGlyph className="size-9 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{HEADLINE}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              On iPhone we can only send alerts once the shop is on your home
              screen. It takes about ten seconds.
            </p>
            <InstallHelpSheet
              trigger={
                <Button size="sm" className="mt-2">
                  <SmartphoneIcon aria-hidden />
                  Add to home screen
                </Button>
              }
            />
          </div>
        </div>
      </Shell>
    );
  }

  /* ---------- blocked in browser settings ---------- */

  if (push.status === "denied") {
    return (
      <Shell className={className}>
        <div className="flex items-start gap-3">
          <BellGlyph className="size-9 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{HEADLINE}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Alerts are switched off for this shop. Tap the lock icon next to
              the web address, allow alerts, then tap Check again.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={push.refresh}
              className="mt-2"
            >
              Check again
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  /* ---------- the ask ---------- */

  return (
    <Shell className={className}>
      <div className="flex items-start gap-3">
        <BellGlyph className="size-9 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{HEADLINE}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            One alert on this phone when your prices open. Nothing else.
          </p>

          {push.error ? (
            <p
              role="alert"
              className="mt-2 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
            >
              {push.error}
            </p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={enable} disabled={push.busy}>
              {push.busy ? (
                <Spinner size="xs" label="" />
              ) : (
                <BellRingIcon aria-hidden />
              )}
              {push.busy
                ? "Just a moment…"
                : push.error
                  ? "Try again"
                  : "Yes, tell me"}
            </Button>

            {/* iPhone users are already installed here (otherwise the status
                would be "needs-install"), so this is for everyone else. */}
            {ios ? null : (
              <InstallHelpSheet
                trigger={
                  <Button size="sm" variant="ghost" disabled={push.busy}>
                    Add to home screen
                  </Button>
                }
              />
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}

export default RequestApprovedNudge;
