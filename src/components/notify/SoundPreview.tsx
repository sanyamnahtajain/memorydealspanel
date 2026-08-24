"use client";

import * as React from "react";
import { BellRing, Play, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  playTune,
  stopTune,
  TUNE_DURATION_MS,
  unlockAudio,
  type TuneKind,
} from "@/lib/notify/tune";

/**
 * "Play sample" — lets someone hear a notification sound before they rely on
 * it, on any settings screen that offers a choice of alert.
 *
 * WHY IT EXISTS: staff turn notification sounds on and then never find out
 * whether the phone is actually loud enough until they miss an order. Hearing
 * it once, on the spot, is the whole point.
 *
 * The click doubles as the browser's "user gesture", which is what allows
 * sound to play at all — so if the very first attempt is still blocked we say
 * so plainly and let them tap again.
 */

interface SoundPreviewProps {
  kind: TuneKind;
  /** Button text while idle. */
  label?: string;
  className?: string;
}

export function SoundPreview({
  kind,
  label = "Play sample",
  className,
}: SoundPreviewProps) {
  const [playing, setPlaying] = React.useState(false);
  const [blocked, setBlocked] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // Never leave a tune ringing after the screen has gone.
  React.useEffect(
    () => () => {
      clearTimer();
      stopTune();
    },
    [clearTimer],
  );

  const stop = React.useCallback(() => {
    clearTimer();
    stopTune();
    setPlaying(false);
  }, [clearTimer]);

  const play = React.useCallback(() => {
    // This click IS the gesture the browser waits for.
    unlockAudio();
    clearTimer();
    stopTune();

    if (!playTune(kind)) {
      setPlaying(false);
      setBlocked(true);
      return;
    }
    setBlocked(false);
    setPlaying(true);
    timer.current = setTimeout(() => setPlaying(false), TUNE_DURATION_MS[kind]);
  }, [kind, clearTimer]);

  return (
    <div className={className}>
      <Button
        type="button"
        variant={playing ? "secondary" : "outline"}
        size="sm"
        onClick={playing ? stop : play}
        aria-label={playing ? "Stop the sample" : `${label} sound`}
      >
        {playing ? (
          <Square data-icon="inline-start" className="fill-current" aria-hidden />
        ) : (
          <Play data-icon="inline-start" className="fill-current" aria-hidden />
        )}
        {playing ? "Stop" : label}
      </Button>

      {blocked ? (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
          <BellRing className="size-3.5" aria-hidden />
          Your browser blocked the sound. Tap the button once more.
        </p>
      ) : null}
    </div>
  );
}
