"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";

import { playTune, unlockAudio } from "@/lib/notify/tune";
import { playVoice, stopVoice } from "@/lib/notify/voice";

/**
 * Plays the Memory Deals tune when a push arrives while the app is OPEN.
 *
 * Why this component has to exist: a Web Push notification drawn by the
 * operating system always uses the OS sound — the Notification API's `sound`
 * property was removed and no browser honours a custom one. The only place a
 * branded tune can play is inside a running page. So the service worker
 * (public/sw.js) messages every visible client on each push, and this bridge
 * turns that message into sound plus an in-app toast.
 *
 * The result for the shop: staff with the admin app open hear the full loud
 * tune, and staff whose phone is locked still get the normal OS notification.
 * Nothing is lost either way.
 *
 * Audio is gesture-locked by every browser, so we also install a one-time
 * unlock on the first tap anywhere. Muting uses the same key as the admin
 * live-events ring, so one mute switch governs both.
 */

/** Shared with AdminLiveEvents — one mute switch for all shop sounds. */
const MUTE_KEY = "md-admin-sound-muted";

interface PushMessage {
  source: "memorydeals-push";
  payload: {
    title?: string;
    body?: string;
    url?: string;
    type?: string;
    sound?: "long" | "short" | "none";
  };
}

function isPushMessage(data: unknown): data is PushMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { source?: unknown }).source === "memorydeals-push"
  );
}

function isMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function PushSoundBridge() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  // The admin panel already has its own live-event channel (AdminLiveEvents
  // over SSE), which rings the loop and shows the full-screen takeover. If we
  // also reacted to the push here, one order would ring twice and toast twice.
  // The SSE side owns staff sound; this bridge owns the storefront.
  const onAdminSurface = pathname.startsWith("/admin");

  // Pending voice-line timers, cleared on unmount so a line cannot start
  // speaking after the user has navigated away.
  const voiceTimers = React.useRef<number[]>([]);

  React.useEffect(() => {
    if (onAdminSurface) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    // The first tap anywhere unlocks audio for the rest of the session; until
    // then the browser silently refuses to play anything.
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });

    const onMessage = (event: MessageEvent) => {
      if (!isPushMessage(event.data)) return;
      const { title, body, url, sound } = event.data.payload;

      if (sound !== "none" && !isMuted()) {
        playTune(sound === "long" ? "long" : "short");
        // …then speak the line for this event, if one has been generated.
        // Delayed so the tune lands first and the two do not talk over each
        // other. Silent no-op when the audio file isn't there.
        const voiceTimer = window.setTimeout(
          () => playVoice(event.data.payload.type),
          sound === "long" ? 1400 : 900,
        );
        voiceTimers.current.push(voiceTimer);
      }

      // An in-app toast, because a notification card is easy to miss when the
      // user is already looking at the app it came from.
      toast(title || "New update", {
        description: body,
        action: url
          ? { label: "View", onClick: () => router.push(url) }
          : undefined,
      });
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    const timers = voiceTimers.current;
    return () => {
      window.removeEventListener("pointerdown", unlock);
      navigator.serviceWorker.removeEventListener("message", onMessage);
      for (const id of timers) window.clearTimeout(id);
      timers.length = 0;
      stopVoice();
    };
  }, [onAdminSurface, router]);

  return null;
}

export default PushSoundBridge;
