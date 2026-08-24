import type { GroupColor } from "@/lib/billing-groups/types";

/**
 * Billing-group colour tokens → Tailwind classes. A static map (never a
 * template string) so Tailwind v4 can see every class at build time. Each
 * entry is dark-mode safe: tinted surfaces use alpha so they read on both
 * themes, text flips to the 300 shade in dark.
 */
export interface GroupColorClasses {
  /** The accent bar on a bucket card's header. */
  bar: string;
  /** The code badge ("DLR"). */
  badge: string;
  /** The progress-bar fill. */
  progress: string;
  /** The progress-bar track. */
  track: string;
  /** Emphasised text (applied-tier copy, nudge). */
  text: string;
}

const MAP: Record<GroupColor, GroupColorClasses> = {
  blue: {
    bar: "bg-blue-500",
    badge: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    progress: "bg-blue-500",
    track: "bg-blue-500/15",
    text: "text-blue-700 dark:text-blue-300",
  },
  emerald: {
    bar: "bg-emerald-500",
    badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    progress: "bg-emerald-500",
    track: "bg-emerald-500/15",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  violet: {
    bar: "bg-violet-500",
    badge: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
    progress: "bg-violet-500",
    track: "bg-violet-500/15",
    text: "text-violet-700 dark:text-violet-300",
  },
  amber: {
    bar: "bg-amber-500",
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    progress: "bg-amber-500",
    track: "bg-amber-500/15",
    text: "text-amber-700 dark:text-amber-300",
  },
  rose: {
    bar: "bg-rose-500",
    badge: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
    progress: "bg-rose-500",
    track: "bg-rose-500/15",
    text: "text-rose-700 dark:text-rose-300",
  },
  cyan: {
    bar: "bg-cyan-500",
    badge: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    progress: "bg-cyan-500",
    track: "bg-cyan-500/15",
    text: "text-cyan-700 dark:text-cyan-300",
  },
  slate: {
    bar: "bg-slate-400 dark:bg-slate-500",
    badge: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
    progress: "bg-slate-500",
    track: "bg-slate-500/15",
    text: "text-slate-700 dark:text-slate-300",
  },
};

/** Classes for a colour token; unknown tokens fall back to slate. */
export function groupColorClasses(color: string): GroupColorClasses {
  return (MAP as Record<string, GroupColorClasses>)[color] ?? MAP.slate;
}
