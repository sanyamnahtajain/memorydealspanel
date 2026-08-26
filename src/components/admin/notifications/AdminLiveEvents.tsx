"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  PackagePlus,
  UserPlus,
  Bell,
  Volume2,
  VolumeX,
  BellRing,
  MessageSquare,
  PackageX,
} from "lucide-react";

import { formatPaise } from "@/components/common/PricePill";
import { ADMIN_EVENT_NAME, type AdminEventDTO } from "@/lib/admin-events";
import {
  installAudioUnlockListeners,
  startLoopingTune,
  stopTune,
  unlockAudio,
  type TuneKind,
  playBlip,
} from "@/lib/notify/tune";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

/**
 * Live admin events (the "socket" client): one EventSource to
 * /api/admin/events for the whole panel.
 *
 * ZOMATO-PANEL BEHAVIOUR (owner request): an order / access request takes over
 * the WHOLE SCREEN — no backdrop, no auto-dismiss — and a LOUD ring loops the
 * entire time until the admin acts (View / Dismiss). Bursts queue up behind
 * the takeover ("+N more"). Unknown event types fall back to a quiet toast.
 *
 * RENDERING: the takeover goes through a PORTAL to <body>. It is mounted from
 * the shell header, whose `backdrop-blur` makes it a CONTAINING BLOCK for
 * fixed-position descendants — rendered in place, "fixed inset-0" would
 * collapse into the 56px header strip (the exact breakage this fixes).
 *
 * SOUND: the actual music lives in @/lib/notify/tune (the shared Memory Deals
 * notification sound). Browsers refuse audio before a user gesture, so the
 * ringer (re)tries to unlock on EVERY repeat, any tap on the takeover unlocks
 * it, and a "tap to enable sound" hint shows while locked.
 */

/* ------------------------------------------------------------------ */
/* Event registry — ADD NEW EVENT TYPES HERE                           */
/* ------------------------------------------------------------------ */

interface EventMeta {
  title: string;
  describe: (payload: Record<string, unknown>) => string;
  href: string;
  /** Label on the takeover's primary action ("View order"). */
  actionLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  /** "long" is the insistent staff alert; "short" the friendly one. */
  tune: TuneKind;
  /** "takeover" = full-screen ringing alert; "toast" = quiet corner note. */
  alert: "takeover" | "toast";
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

const EVENT_META: Record<string, EventMeta> = {
  "order.placed": {
    title: "New order request",
    describe: (p) => {
      const items = num(p.itemCount);
      const subtotal = num(p.subtotalPaise);
      return [
        str(p.orderNumber) && `Order ${str(p.orderNumber)}`,
        items != null && `${items} item${items === 1 ? "" : "s"}`,
        subtotal != null && formatPaise(subtotal),
      ]
        .filter(Boolean)
        .join(" · ");
    },
    href: "/admin/orders",
    actionLabel: "View order",
    icon: PackagePlus,
    tune: "long",
    alert: "takeover",
  },
  access_request: {
    title: "New access request",
    describe: (p) => [str(p.businessName), str(p.phone)].filter(Boolean).join(" · "),
    href: "/admin/requests",
    actionLabel: "Review request",
    icon: UserPlus,
    tune: "long",
    alert: "takeover",
  },
  renewal_request: {
    title: "Access renewal request",
    describe: (p) =>
      [str(p.businessName), str(p.phone)].filter(Boolean).join(" · ") +
      " · access lapsed",
    href: "/admin/requests",
    actionLabel: "Review renewal",
    icon: UserPlus,
    tune: "long",
    alert: "takeover",
  },
  "order.cancelledByCustomer": {
    title: "Order cancelled",
    describe: (p) => {
      const number = str(p.orderNumber);
      return number ? `#${number} withdrawn by the customer` : "";
    },
    href: "/admin/orders",
    actionLabel: "Open orders",
    icon: PackageX,
    // A withdrawal needs to be seen, but nothing is waiting on staff — a
    // toast, not a takeover that must be dismissed.
    tune: "short",
    alert: "toast",
  },
  contact_message: {
    title: "New contact message",
    describe: (p) =>
      [str(p.name), str(p.phone), str(p.reason)].filter(Boolean).join(" · "),
    href: "/admin/contact",
    actionLabel: "Read message",
    icon: MessageSquare,
    // Someone wants a call back — worth seeing, but nobody is stuck waiting:
    // a quiet toast with the short tune, never a ringing takeover.
    tune: "short",
    alert: "toast",
  },
};

const FALLBACK_META: EventMeta = {
  title: "New notification",
  describe: () => "",
  href: "/admin/dashboard",
  actionLabel: "Open",
  icon: Bell,
  tune: "short",
  alert: "toast",
};

const metaFor = (type: string): EventMeta => EVENT_META[type] ?? FALLBACK_META;

/* ------------------------------------------------------------------ */
/* Ring engine — LOUD, LOOPING until acknowledged (no audio asset)     */
/* ------------------------------------------------------------------ */

const MUTE_KEY = "md-admin-sound-muted";

/** How often the phone buzzes while the takeover is up. */
const VIBRATE_MS = 1_600;

function isMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Loops the Memory Deals tune (+ phone vibration) until stopped. */
function useRinger(onAudibleChange: (audible: boolean) => void) {
  const buzzTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const cb = React.useRef(onAudibleChange);
  React.useEffect(() => {
    cb.current = onAudibleChange;
  }, [onAudibleChange]);

  const stop = React.useCallback(() => {
    stopTune();
    if (buzzTimer.current) clearInterval(buzzTimer.current);
    buzzTimer.current = null;
    try {
      navigator.vibrate?.(0);
    } catch {
      /* unsupported */
    }
  }, []);

  const start = React.useCallback(
    (tune: TuneKind) => {
      stop();
      // The tune module re-attempts the unlock on every repeat, and retries
      // quickly while it is still locked or muted: the moment the admin's
      // first tap lets audio through, the NEXT repeat rings — no reload, no
      // lost alert. Mute is re-read each time so the header toggle takes
      // effect mid-ring.
      startLoopingTune(tune, {
        shouldPlay: () => !isMuted(),
        onRepeat: (audible) => cb.current(audible || isMuted()),
      });
      // Vibration keeps its own faster beat — a phone in a pocket should buzz
      // more often than once per tune.
      const buzz = () => {
        try {
          navigator.vibrate?.([320, 160, 320]);
        } catch {
          /* unsupported */
        }
      };
      buzz();
      buzzTimer.current = setInterval(buzz, VIBRATE_MS);
    },
    [stop],
  );

  React.useEffect(() => stop, [stop]);
  return { start, stop };
}

/* ------------------------------------------------------------------ */
/* The listener + full-screen takeover (PORTALED to <body>)            */
/* ------------------------------------------------------------------ */

export function AdminLiveEvents() {
  const router = useRouter();
  const reduced = useReducedMotion();
  // False while the ring WANTS to sound but audio is still gesture-locked —
  // drives the "tap to enable sound" hint on the takeover.
  const [audible, setAudible] = React.useState(true);
  const { start, stop } = useRinger(setAudible);
  // Portal target exists only in the browser.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(t);
  }, []);

  // Takeover queue: newest events wait behind the one on screen. NOTHING here
  // auto-dismisses — only View / Dismiss advance the queue.
  const [queue, setQueue] = React.useState<AdminEventDTO[]>([]);
  const current = queue[0] ?? null;

  React.useEffect(() => {
    installAudioUnlockListeners();
    const source = new EventSource("/api/admin/events");

    const onEvent = (raw: MessageEvent) => {
      let event: AdminEventDTO;
      try {
        event = JSON.parse(raw.data as string) as AdminEventDTO;
      } catch {
        return;
      }
      const meta = metaFor(event.type);
      if (meta.alert === "takeover") {
        setQueue((prev) =>
          prev.some((e) => e.id === event.id) ? prev : [...prev, event],
        );
      } else {
        const Icon = meta.icon;
        toast(meta.title, {
          id: event.id,
          description: meta.describe(event.payload) || undefined,
          icon: <Icon className="size-4 text-primary" aria-hidden />,
          duration: 8000,
          action: { label: meta.actionLabel, onClick: () => router.push(meta.href) },
        });
      }
      // Refresh server components so badges + queues update live.
      router.refresh();
    };

    source.addEventListener(ADMIN_EVENT_NAME, onEvent);
    // EventSource reconnects automatically on error — nothing to do.
    return () => {
      source.removeEventListener(ADMIN_EVENT_NAME, onEvent);
      source.close();
    };
  }, [router]);

  // Ring for as long as ANY takeover is on screen; retune when it changes.
  React.useEffect(() => {
    if (!current) {
      stop();
      return;
    }
    start(metaFor(current.type).tune);
    return stop;
  }, [current, start, stop]);

  const dismissCurrent = React.useCallback(() => {
    setQueue((prev) => prev.slice(1));
  }, []);

  const viewCurrent = React.useCallback(() => {
    if (!current) return;
    const href = metaFor(current.type).href;
    // Going to the list handles every queued event of that kind too.
    setQueue((prev) => prev.filter((e) => metaFor(e.type).href !== href));
    router.push(href);
  }, [current, router]);

  if (!mounted) return null;

  const meta = current ? metaFor(current.type) : null;
  const Icon = meta?.icon ?? Bell;
  const showSoundHint = !audible && !isMuted();

  // PORTAL: escape the header's backdrop-filter containing block, always.
  return createPortal(
    <AnimatePresence>
      {current && meta && (
        <motion.div
          key="admin-takeover"
          role="alertdialog"
          aria-modal="true"
          aria-label={meta.title}
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.18 } }}
          onPointerDown={() => {
            // Any tap on the takeover is the unlocking gesture.
            unlockAudio();
          }}
          className="fixed inset-0 z-[95] flex flex-col items-center justify-center overflow-y-auto bg-background px-6 py-10 text-center"
          style={{
            paddingTop: "calc(env(safe-area-inset-top) + 2.5rem)",
            paddingBottom: "calc(env(safe-area-inset-bottom) + 2.5rem)",
          }}
        >
          {/* Urgency pulse rings behind the icon. */}
          <div className="relative mb-8 shrink-0">
            {!reduced &&
              [0, 1].map((i) => (
                <motion.span
                  key={i}
                  aria-hidden
                  initial={{ scale: 1, opacity: 0.45 }}
                  animate={{ scale: 2.4, opacity: 0 }}
                  transition={{
                    duration: 1.6,
                    delay: i * 0.8,
                    repeat: Infinity,
                    ease: "easeOut",
                  }}
                  className="absolute inset-0 rounded-full border-2 border-primary"
                />
              ))}
            <motion.span
              animate={reduced ? undefined : { rotate: [0, -8, 8, -6, 6, 0] }}
              transition={{ duration: 0.7, repeat: Infinity, repeatDelay: 0.9 }}
              className="relative flex size-24 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
            >
              <Icon className="size-11" aria-hidden />
            </motion.span>
          </div>

          <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">
            Action needed
          </p>
          <h2 className="mt-2 font-heading text-3xl font-bold text-foreground">
            {meta.title}
          </h2>
          {meta.describe(current.payload) ? (
            <p className="mt-3 max-w-md text-base text-muted-foreground">
              {meta.describe(current.payload)}
            </p>
          ) : null}
          {queue.length > 1 ? (
            <p className="mt-2 rounded-full bg-muted px-3 py-1 text-sm font-medium text-muted-foreground">
              +{queue.length - 1} more waiting
            </p>
          ) : null}

          <div className="mt-10 flex w-full max-w-xs shrink-0 flex-col gap-3">
            <Button size="lg" className="h-13 w-full text-base" onClick={viewCurrent}>
              {meta.actionLabel}
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="h-11 w-full"
              onClick={dismissCurrent}
            >
              Dismiss
            </Button>
          </div>

          {showSoundHint ? (
            <p className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
              <BellRing className="size-3.5" aria-hidden />
              Tap anywhere once to enable the ring
            </p>
          ) : (
            <p className="mt-6 text-xs text-muted-foreground">
              This alert stays (and keeps ringing) until you act.
            </p>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Sound toggle (shell header)                                         */
/* ------------------------------------------------------------------ */

export function AdminSoundToggle() {
  const [muted, setMuted] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setMuted(isMuted()), 0);
    return () => clearTimeout(t);
  }, []);

  function toggle() {
    const next = !muted;
    setMuted(next);
    try {
      window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
    } catch {
      /* private mode */
    }
    if (!next) {
      unlockAudio(); // the click IS a gesture — unlock right here
      // A short blip, not the full 4.5s tune — this is a toggle
      // acknowledgement, not an alert.
      playBlip();
    }
  }

  const IconEl = muted ? VolumeX : Volume2;
  return (
    <Tooltip content={muted ? "Notification sounds off" : "Notification sounds on"}>
      <button
        type="button"
        onClick={toggle}
        aria-label={muted ? "Unmute notification sounds" : "Mute notification sounds"}
        aria-pressed={!muted}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-foreground/70 outline-none transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-90"
      >
        <IconEl className="size-5" aria-hidden />
      </button>
    </Tooltip>
  );
}
