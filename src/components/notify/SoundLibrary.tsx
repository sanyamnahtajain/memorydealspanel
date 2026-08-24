"use client";

import * as React from "react";
import { BellRing, Music4, VolumeX } from "lucide-react";

import { cn } from "@/lib/utils";
import { TUNE_DURATION_MS, type TuneKind } from "@/lib/notify/tune";
import { NOTIFY_TOPICS, topicsFor, type NotifyAudience } from "@/lib/notify/topics";
import { SoundPreview } from "./SoundPreview";

/**
 * Every sound the shop can make, with a button to hear it (owner request:
 * "list all notification sounds to hear").
 *
 * Two reasons this is worth a section of its own rather than a buried
 * setting. First, staff cannot judge whether the alert is loud enough for a
 * noisy shop until they have actually heard it — and the moment they find out
 * otherwise is the moment they miss an order. Second, it makes the mapping
 * explicit: this tune means money is waiting, that one is routine. Hearing
 * them side by side is the only way that lands.
 *
 * The list of which alerts use which tune is derived from the topic
 * catalogue, so it can never drift from what actually plays.
 */

interface SoundRow {
  kind: TuneKind;
  name: string;
  purpose: string;
  icon: typeof BellRing;
  accent: string;
}

const SOUNDS: SoundRow[] = [
  {
    kind: "long",
    name: "Long ring",
    purpose:
      "For anything with money waiting. Repeats until someone deals with it.",
    icon: BellRing,
    accent: "bg-primary/10 text-primary",
  },
  {
    kind: "short",
    name: "Short tune",
    purpose: "A single friendly chime for everything routine.",
    icon: Music4,
    accent: "bg-muted text-foreground",
  },
];

function secondsLabel(kind: TuneKind): string {
  // One decimal: the difference between 4.6s and 11.1s is the point.
  return `${(TUNE_DURATION_MS[kind] / 1000).toFixed(1)}s`;
}

/** Which alerts in this audience use the given tune. */
function usedBy(kind: TuneKind, audience: NotifyAudience | "all"): string[] {
  const pool = audience === "all" ? NOTIFY_TOPICS : topicsFor(audience);
  return pool.filter((topic) => topic.sound === kind).map((topic) => topic.label);
}

export function SoundLibrary({
  audience = "all",
  className,
}: {
  /** Restrict the "used by" lists to one side of the app. */
  audience?: NotifyAudience | "all";
  className?: string;
}) {
  const silent = (audience === "all" ? NOTIFY_TOPICS : topicsFor(audience)).filter(
    (topic) => topic.sound === "none",
  );

  return (
    <div className={cn("space-y-3", className)}>
      <ul className="space-y-2.5">
        {SOUNDS.map((sound) => {
          const alerts = usedBy(sound.kind, audience);
          return (
            <li
              key={sound.kind}
              className="rounded-xl border border-border bg-card p-3.5 sm:p-4"
            >
              <div className="flex flex-wrap items-start gap-3">
                <span
                  className={cn(
                    "inline-flex size-10 shrink-0 items-center justify-center rounded-full",
                    sound.accent,
                  )}
                >
                  <sound.icon className="size-5" aria-hidden />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-foreground">
                    {sound.name}
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                      {secondsLabel(sound.kind)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                    {sound.purpose}
                  </p>
                </div>

                <SoundPreview
                  kind={sound.kind}
                  label="Play"
                  className="shrink-0"
                />
              </div>

              {alerts.length > 0 ? (
                <div className="mt-3 border-t border-border pt-2.5">
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    Used for
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {alerts.join(" · ")}
                  </p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {silent.length > 0 ? (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <VolumeX className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>Arrives silently: {silent.map((t) => t.label).join(" · ")}</span>
        </p>
      ) : null}

      {/* Stated plainly because staff WILL notice it and report it as a bug. */}
      <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        These tunes play while the app is open on this device. When your phone
        is locked or the app is closed, the phone plays its own notification
        sound — no website can change that.
      </p>
    </div>
  );
}

export default SoundLibrary;
