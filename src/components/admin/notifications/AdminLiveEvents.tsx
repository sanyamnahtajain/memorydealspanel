"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PackagePlus, UserPlus, Bell, Volume2, VolumeX } from "lucide-react";

import { formatPaise } from "@/components/common/PricePill";
import { ADMIN_EVENT_NAME, type AdminEventDTO } from "@/lib/admin-events";
import { Tooltip } from "@/components/ui/tooltip";

/**
 * Live admin events (the "socket" client): one EventSource to
 * /api/admin/events for the whole panel. Each event → a sonner toast with a
 * "View" action, a synthesized ring, and a router.refresh() so badges/lists
 * update without a reload. Extensible via EVENT_META — one entry per event
 * type, nothing else to touch.
 */

/* ------------------------------------------------------------------ */
/* Event registry — ADD NEW EVENT TYPES HERE                           */
/* ------------------------------------------------------------------ */

type Tune = "order" | "request" | "ping";

interface EventMeta {
  title: string;
  describe: (payload: Record<string, unknown>) => string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  tune: Tune;
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
    icon: PackagePlus,
    tune: "order",
  },
  access_request: {
    title: "New access request",
    describe: (p) => [str(p.businessName), str(p.phone)].filter(Boolean).join(" · "),
    href: "/admin/requests",
    icon: UserPlus,
    tune: "request",
  },
};

const FALLBACK_META: EventMeta = {
  title: "New notification",
  describe: () => "",
  href: "/admin/dashboard",
  icon: Bell,
  tune: "ping",
};

/* ------------------------------------------------------------------ */
/* Ring tunes — synthesized (no audio asset, nothing to precache)      */
/* ------------------------------------------------------------------ */

const MUTE_KEY = "md-admin-sound-muted";

let audioCtx: AudioContext | null = null;
let unlocked = false;

/** Browsers require a user gesture before audio — arm once, globally. */
function armAudioUnlock() {
  if (typeof window === "undefined") return;
  const unlock = () => {
    try {
      audioCtx = audioCtx ?? new AudioContext();
      void audioCtx.resume();
      unlocked = true;
    } catch {
      /* no audio available */
    }
  };
  window.addEventListener("pointerdown", unlock, { once: true, passive: true });
  window.addEventListener("keydown", unlock, { once: true });
}

/** One enveloped sine note. */
function note(ctx: AudioContext, freq: number, at: number, dur: number, gainPeak = 0.12) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(gainPeak, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

/** The ring: order = rising arpeggio; request = door-chime; ping = single. */
function playTune(tune: Tune) {
  if (!unlocked || !audioCtx) return;
  try {
    const t = audioCtx.currentTime;
    if (tune === "order") {
      note(audioCtx, 880, t, 0.35);
      note(audioCtx, 1108.7, t + 0.14, 0.35);
      note(audioCtx, 1318.5, t + 0.28, 0.6, 0.14);
    } else if (tune === "request") {
      note(audioCtx, 987.8, t, 0.4);
      note(audioCtx, 784, t + 0.22, 0.7);
    } else {
      note(audioCtx, 1046.5, t, 0.4);
    }
  } catch {
    /* audio device gone — stay silent */
  }
}

function isMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* The listener (renders nothing)                                      */
/* ------------------------------------------------------------------ */

export function AdminLiveEvents() {
  const router = useRouter();

  React.useEffect(() => {
    armAudioUnlock();
    const source = new EventSource("/api/admin/events");

    const onEvent = (raw: MessageEvent) => {
      let event: AdminEventDTO;
      try {
        event = JSON.parse(raw.data as string) as AdminEventDTO;
      } catch {
        return;
      }
      const meta = EVENT_META[event.type] ?? FALLBACK_META;
      const Icon = meta.icon;
      toast(meta.title, {
        id: event.id, // dedupes a replay after an SSE reconnect
        description: meta.describe(event.payload) || undefined,
        icon: <Icon className="size-4 text-primary" aria-hidden />,
        duration: 8000,
        action: { label: "View", onClick: () => router.push(meta.href) },
      });
      if (!isMuted()) playTune(meta.tune);
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

  return null;
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
    if (!next) playTune("ping"); // audible confirmation on unmute
  }

  const Icon = muted ? VolumeX : Volume2;
  return (
    <Tooltip content={muted ? "Notification sounds off" : "Notification sounds on"}>
      <button
        type="button"
        onClick={toggle}
        aria-label={muted ? "Unmute notification sounds" : "Mute notification sounds"}
        aria-pressed={!muted}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-foreground/70 outline-none transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-90"
      >
        <Icon className="size-5" aria-hidden />
      </button>
    </Tooltip>
  );
}
