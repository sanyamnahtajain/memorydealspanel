"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  BellRing,
  Check,
  CircleAlert,
  Globe,
  Lock,
  RefreshCw,
  Send,
  Share,
  Smartphone,
  SquarePlus,
  Wrench,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmSheet } from "@/components/common/ConfirmSheet";
import type { NotifyTopicState } from "@/lib/notify/prefs";
import {
  sendTestNotificationAction,
  setAllNotifyTopicsAction,
  setNotifyTopicAction,
} from "@/server/actions/notify";
import { useEngagement } from "./useEngagement";
import { usePushSubscription } from "./usePushSubscription";

/**
 * The MANUAL notification controls — the switch a person goes looking for,
 * as opposed to {@link NotifyGate}, which decides on its own when to ask.
 *
 * One component serves both audiences (`variant`), because the questions are
 * identical: *is this device allowed to ring*, *which messages do I want*, and
 * *does it actually work*. Only the wording differs.
 *
 * Three things live here, in the order a confused user needs them:
 *   1. This device — the honest status, and the one button that changes it.
 *      Every state gets its own explanation, including the states no button
 *      can fix (iPhone needs the app installed; the browser hard-blocked us).
 *   2. What you get — the per-topic switches. Account-critical topics render
 *      as an "Always on" row rather than a dead switch, so nothing looks
 *      broken.
 *   3. The app — install state, plus a deliberate way to bring the install
 *      card back after dismissing it.
 *
 * COPY RULE (owner request): the shop's customers are not fluent readers.
 * Short sentences, no jargon — never "subscription", "permission", "endpoint".
 */

type PanelVariant = "storefront" | "admin";

export interface NotificationSettingsPanelProps {
  /** Topic rows resolved on the server for the signed-in person. */
  topics: NotifyTopicState[];
  /** Which audience is reading. Changes wording only. */
  variant?: PanelVariant;
  className?: string;
}

interface VariantCopy {
  deviceTitle: string;
  deviceHint: string;
  topicsTitle: string;
  topicsHint: string;
  onBody: string;
  offBody: string;
  turnOn: string;
  confirmOffTitle: string;
  confirmOffBody: string;
  installHint: string;
}

const COPY: Record<PanelVariant, VariantCopy> = {
  storefront: {
    deviceTitle: "This device",
    deviceHint: "Alerts are per device. Turn them on wherever you want them.",
    topicsTitle: "What you get",
    topicsHint: "Pick the messages you want. Order news always comes through.",
    onBody: "Alerts are on for this device.",
    offBody: "Turn them on to hear about your orders and your prices.",
    turnOn: "Turn on alerts",
    confirmOffTitle: "Turn off alerts?",
    confirmOffBody:
      "This device will stop telling you about your orders and your prices.",
    installHint: "The app opens faster and can alert you more reliably.",
  },
  admin: {
    deviceTitle: "This device",
    deviceHint: "Alerts are per device. Turn them on for every device staff use.",
    topicsTitle: "What rings here",
    topicsHint: "Pick what this account gets. New orders always come through.",
    onBody: "Alerts are on for this device.",
    offBody: "This device will not ring for new orders until you do.",
    turnOn: "Turn on alerts",
    confirmOffTitle: "Turn off alerts?",
    confirmOffBody:
      "This device will stop ringing for new orders and new requests.",
    installHint: "Installed, the panel rings far more reliably.",
  },
};

/* ------------------------------------------------------------------ *
 * Small building blocks — same visual language as PreferencesPanel.
 * ------------------------------------------------------------------ */

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

type Tone = "good" | "warn" | "muted";

const TONE_TILE: Record<Tone, string> = {
  good: "bg-success/10 text-success",
  warn: "bg-warning/15 text-warning-foreground dark:text-warning",
  muted: "bg-muted text-muted-foreground",
};

const TONE_CARD: Record<Tone, string> = {
  good: "border-success/25 bg-success/5",
  warn: "border-warning/30 bg-warning/5",
  muted: "border-border bg-muted/30",
};

/** A friendly bell, drawn in the same minimal style as the empty states. */
function BellIllustration(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden {...props}>
      <path
        d="M24 8a10 10 0 0 1 10 10v7l3 5a1.5 1.5 0 0 1-1.3 2.3H12.3A1.5 1.5 0 0 1 11 30l3-5v-7A10 10 0 0 1 24 8Z"
        className="fill-current stroke-current"
        fillOpacity="0.15"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M20 36a4 4 0 0 0 8 0"
        className="stroke-current"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M24 4v3" className="stroke-current" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M38 14a12 12 0 0 1 3 7M10 14a12 12 0 0 0-3 7"
        className="stroke-current opacity-50"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The status card: icon tile, one plain line, an explanation, then controls. */
function DeviceCard({
  tone,
  icon,
  title,
  body,
  children,
  extra,
}: {
  tone: Tone;
  icon: React.ReactNode;
  title: string;
  body: string;
  /** Buttons. */
  children?: React.ReactNode;
  /** Anything richer (the iPhone steps). */
  extra?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-3.5 sm:flex-row sm:items-start sm:gap-3.5",
        TONE_CARD[tone],
      )}
    >
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-xl",
          TONE_TILE[tone],
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
        {extra}
        {children ? (
          <div className="flex flex-wrap items-center gap-2 pt-1.5">{children}</div>
        ) : null}
      </div>
    </div>
  );
}

/** Numbered "add to home screen" steps, for iPhone and iPad. */
function IosSteps() {
  const steps = [
    { icon: Share, text: "Tap the share button at the bottom of Safari." },
    { icon: SquarePlus, text: "Choose “Add to Home Screen”." },
    { icon: Smartphone, text: "Open the app from your home screen." },
  ] as const;

  return (
    <ol className="mt-2 space-y-1.5">
      {steps.map((step, index) => {
        const Icon = step.icon;
        return (
          <li key={step.text} className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid size-5 shrink-0 place-items-center rounded-full bg-foreground/10 text-[11px] font-semibold text-foreground/70"
            >
              {index + 1}
            </span>
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="text-xs text-foreground/80">{step.text}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Inline failure with a way back — never a dead end. */
function InlineError({
  message,
  onRetry,
  retryLabel = "Try again",
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
    >
      <CircleAlert className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry ? (
        <Button size="xs" variant="ghost" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Panel.
 * ------------------------------------------------------------------ */

export function NotificationSettingsPanel({
  topics,
  variant = "storefront",
  className,
}: NotificationSettingsPanelProps) {
  const copy = COPY[variant];
  const push = usePushSubscription();
  // Staff and buyers keep separate usage ledgers, so the manual re-arm here
  // has to touch the same one the prompt on this surface reads.
  const engagement = useEngagement(variant === "admin" ? "admin" : "storefront");

  // Optimistic copy of the server rows. Re-seeded whenever the server hands
  // us a new array (after a revalidate), without an effect.
  const [rows, setRows] = React.useState<NotifyTopicState[]>(topics);
  const [bulkPending, startBulk] = React.useTransition();
  const [seeded, setSeeded] = React.useState<NotifyTopicState[]>(topics);
  if (topics !== seeded) {
    setSeeded(topics);
    setRows(topics);
  }

  const [pendingKey, setPendingKey] = React.useState<string | null>(null);
  const [topicError, setTopicError] = React.useState<{
    message: string;
    retry: () => void;
  } | null>(null);

  const [, startTopic] = React.useTransition();
  const [testing, startTest] = React.useTransition();

  /** Is this browser running as the installed app? */
  const [installed, setInstalled] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    const query = window.matchMedia("(display-mode: standalone)");
    const read = () =>
      setInstalled(
        query.matches ||
          (window.navigator as Navigator & { standalone?: boolean })
            .standalone === true,
      );
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, []);

  /* ---------------- device on/off ---------------- */

  const turnOn = React.useCallback(async () => {
    const granted = await push.enable();
    if (granted) {
      // The device settled it — the automatic card must stop asking.
      engagement.markSatisfied("notify");
      toast.success("Alerts are on for this device.");
      return;
    }
    // The exact reason is shown inline under the card; keep the toast short.
    toast.error("Could not turn on alerts.");
  }, [engagement, push]);

  const turnOff = React.useCallback(async () => {
    const done = await push.disable();
    if (!done) {
      toast.error("Could not turn off alerts. Please try again.");
      // Keeps the confirm surface open so the user can retry.
      throw new Error("disable failed");
    }
    // Someone who switches off deliberately deserves a clean slate if they
    // change their mind — not the long backoff a decline would earn.
    engagement.reset("notify");
    toast.success("Alerts are off on this device.");
  }, [engagement, push]);

  // Only the switchable rows count towards the master control — locked ones
  // are always on, so including them would make "Turn all off" look broken.
  const optionalRows = rows.filter((row) => row.topic.lockedOn !== true);
  const optionalCount = optionalRows.length;
  const allOptionalOn =
    optionalCount > 0 && optionalRows.every((row) => row.enabled);

  /* ---------------- topic switches ---------------- */

  function applyTopic(topicKey: string, enabled: boolean) {
    setTopicError(null);
    const previous = rows;
    setRows((current) =>
      current.map((row) =>
        row.topic.key === topicKey ? { ...row, enabled } : row,
      ),
    );
    setPendingKey(topicKey);

    startTopic(async () => {
      const result = await setNotifyTopicAction({ topicKey, enabled });
      setPendingKey(null);
      if (!result.ok) {
        setRows(previous); // roll back — the server is the truth
        setTopicError({
          message: result.error,
          retry: () => applyTopic(topicKey, enabled),
        });
        toast.error(result.error);
        return;
      }
      setRows(result.topics);
    });
  }

  /**
   * The master switch. Only touches topics the person is allowed to change —
   * the locked ones (your own order, your access ending) stay on, which is
   * why this reads "the rest" rather than "everything".
   */
  function applyAll(enabled: boolean) {
    setTopicError(null);
    const previous = rows;
    setRows((current) =>
      current.map((row) =>
        row.topic.lockedOn ? row : { ...row, enabled },
      ),
    );

    startBulk(async () => {
      const result = await setAllNotifyTopicsAction({ enabled });
      if (!result.ok) {
        setRows(previous);
        setTopicError({
          message: result.error,
          retry: () => applyAll(enabled),
        });
        toast.error(result.error);
        return;
      }
      setRows(result.topics);
      toast.success(enabled ? "All alerts are on." : "The rest are off.");
    });
  }

  /* ---------------- test message ---------------- */

  function sendTest() {
    startTest(async () => {
      const result = await sendTestNotificationAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.sent === 0) {
        toast.info("No device got it.", {
          description: "Turn on alerts on this device first, then try again.",
        });
        return;
      }
      toast.success(
        result.sent === 1
          ? "Sent to 1 device."
          : `Sent to ${result.sent} devices.`,
      );
    });
  }

  /* ---------------- install card ---------------- */

  function showInstallCard() {
    engagement.reset("install");
    toast.success("We will show the install card again.", {
      description: "It appears the next time you open a page.",
    });
  }

  const busy = push.busy;

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {/* ——— 1. This device ——— */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <SectionHeading>{copy.deviceTitle}</SectionHeading>
          <p className="text-xs text-muted-foreground">{copy.deviceHint}</p>
        </div>

        {push.status === "checking" ? (
          <div className="flex items-start gap-3.5 rounded-xl border border-border bg-muted/30 p-3.5">
            <Skeleton className="size-10 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-2 py-0.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-full max-w-64" />
              <Skeleton className="h-7 w-28 rounded-lg" />
            </div>
          </div>
        ) : null}

        {push.status === "on" ? (
          <DeviceCard
            tone="good"
            icon={<BellIllustration className="size-6" />}
            title={copy.onBody}
            body="You will hear from us here. You can turn this off any time."
          >
            <ConfirmSheet
              title={copy.confirmOffTitle}
              description={copy.confirmOffBody}
              confirmLabel="Turn off"
              cancelLabel="Keep them on"
              destructive
              onConfirm={turnOff}
              trigger={
                <Button size="sm" variant="outline" disabled={busy}>
                  {busy ? <Spinner size="xs" label="" /> : null}
                  Turn off
                </Button>
              }
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={sendTest}
              disabled={testing}
            >
              {testing ? (
                <Spinner size="xs" label="" />
              ) : (
                <Send className="size-3.5" aria-hidden />
              )}
              Send me a test
            </Button>
          </DeviceCard>
        ) : null}

        {push.status === "off" ? (
          <DeviceCard
            tone="muted"
            icon={<BellIllustration className="size-6" />}
            title="Alerts are off on this device."
            body={`${copy.offBody} Tap the button, then say Allow when your browser asks.`}
          >
            <Button size="sm" onClick={turnOn} disabled={busy}>
              {busy ? (
                <Spinner size="xs" label="" />
              ) : (
                <BellRing className="size-3.5" aria-hidden />
              )}
              {copy.turnOn}
            </Button>
          </DeviceCard>
        ) : null}

        {push.status === "denied" ? (
          <DeviceCard
            tone="warn"
            icon={<Lock className="size-5" aria-hidden />}
            title="Your browser is blocking alerts."
            body="Tap the lock icon next to the web address, then set alerts to Allow. Come back here and tap Check again."
          >
            <Button size="sm" variant="outline" onClick={push.refresh}>
              <RefreshCw className="size-3.5" aria-hidden />
              Check again
            </Button>
          </DeviceCard>
        ) : null}

        {push.status === "needs-install" ? (
          <DeviceCard
            tone="warn"
            icon={<Smartphone className="size-5" aria-hidden />}
            title="Add the app to your home screen first."
            body="On iPhone and iPad, alerts only work from the home screen app. This is how Apple made it — it is not a fault."
            extra={<IosSteps />}
          >
            <Button size="sm" variant="outline" onClick={push.refresh}>
              <RefreshCw className="size-3.5" aria-hidden />
              I have done this
            </Button>
          </DeviceCard>
        ) : null}

        {push.status === "unsupported" ? (
          <DeviceCard
            tone="muted"
            icon={<Globe className="size-5" aria-hidden />}
            title="This browser cannot show alerts."
            body="Apps like Instagram open links in their own small browser, which cannot alert you. Open this shop in Chrome or Safari and try again."
          />
        ) : null}

        {push.status === "unconfigured" ? (
          <DeviceCard
            tone="warn"
            icon={<Wrench className="size-5" aria-hidden />}
            title="Alerts are not set up on the server yet."
            body="The alert keys are missing on this site. Add them in the server settings, then reload this page."
          >
            <Button size="sm" variant="outline" onClick={push.refresh}>
              <RefreshCw className="size-3.5" aria-hidden />
              Check again
            </Button>
          </DeviceCard>
        ) : null}

        {push.error ? (
          <InlineError message={push.error} onRetry={push.refresh} retryLabel="Check again" />
        ) : null}

        {/* The proof-it-works button, kept available in every state except the
            one where it is already offered inside the card above. */}
        {push.status !== "on" && push.status !== "checking" ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={sendTest}
            disabled={testing}
            className="self-start"
          >
            {testing ? (
              <Spinner size="xs" label="" />
            ) : (
              <Send className="size-3.5" aria-hidden />
            )}
            Send me a test
          </Button>
        ) : null}
      </section>

      {/* ——— 2. What you get ——— */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <SectionHeading>{copy.topicsTitle}</SectionHeading>
            <p className="text-xs text-muted-foreground">{copy.topicsHint}</p>
          </div>
          {optionalCount > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0"
              disabled={bulkPending || pendingKey !== null}
              onClick={() => applyAll(!allOptionalOn)}
            >
              {bulkPending ? (
                <Spinner size="sm" label="" />
              ) : null}
              {allOptionalOn ? "Turn all off" : "Turn all on"}
            </Button>
          ) : null}
        </div>

        {topicError ? (
          <InlineError message={topicError.message} onRetry={topicError.retry} />
        ) : null}

        {rows.length === 0 ? (
          <p className="rounded-xl border border-border bg-muted/30 px-3.5 py-3 text-xs text-muted-foreground">
            There is nothing to choose here yet.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {rows.map((row) => {
              const locked = row.topic.lockedOn === true;
              const saving = pendingKey === row.topic.key;
              return (
                <li
                  key={row.topic.key}
                  className="flex items-start justify-between gap-3 bg-card px-3.5 py-3"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm font-medium text-foreground">
                      {row.topic.label}
                    </p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {row.topic.description}
                    </p>
                    {locked ? (
                      <p className="flex items-center gap-1.5 pt-0.5 text-xs text-muted-foreground">
                        <Lock className="size-3" aria-hidden />
                        {row.topic.audience === "admin"
                          ? "Always on — staff must not miss this."
                          : "Always on — this is about your own order."}
                      </p>
                    ) : null}
                  </div>

                  {locked ? (
                    <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-success/25 bg-success/10 px-2 text-xs font-medium text-success">
                      <Check className="size-3" aria-hidden />
                      On
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-2 pt-0.5">
                      {saving ? (
                        <Spinner size="xs" label="Saving" className="text-muted-foreground" />
                      ) : null}
                      <Switch
                        checked={row.enabled}
                        disabled={saving}
                        onCheckedChange={(checked: boolean) =>
                          applyTopic(row.topic.key, checked)
                        }
                        aria-label={row.topic.label}
                      />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ——— 3. The app ——— */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <SectionHeading>App</SectionHeading>
          <p className="text-xs text-muted-foreground">{copy.installHint}</p>
        </div>

        {installed === null ? (
          <div className="flex items-center gap-3.5 rounded-xl border border-border bg-muted/30 p-3.5">
            <Skeleton className="size-10 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-3 w-52" />
            </div>
          </div>
        ) : installed ? (
          <DeviceCard
            tone="good"
            icon={<Check className="size-5" aria-hidden />}
            title="The app is on this device."
            body="You opened it from your home screen. Nothing to do here."
          />
        ) : (
          <DeviceCard
            tone="muted"
            icon={<Smartphone className="size-5" aria-hidden />}
            title="The app is not added yet."
            body={
              push.iosNeedsInstall
                ? "On iPhone and iPad you add it yourself, in three taps."
                : "Add it to your home screen to open the shop like an app."
            }
            extra={push.iosNeedsInstall ? <IosSteps /> : null}
          >
            {push.iosNeedsInstall ? null : (
              <Button size="sm" variant="outline" onClick={showInstallCard}>
                <SquarePlus className="size-3.5" aria-hidden />
                Show me how
              </Button>
            )}
          </DeviceCard>
        )}
      </section>
    </div>
  );
}

export default NotificationSettingsPanel;
