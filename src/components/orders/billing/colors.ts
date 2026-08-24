/**
 * Static Tailwind class map for billing-group color tokens. Keyed statically
 * (never interpolated) so the classes survive the content scan; dark-mode safe.
 */

export interface BucketColorClasses {
  /** Left accent bar on the bucket header. */
  accent: string;
  /** Code badge (background + text). */
  badge: string;
}

const COLORS: Record<string, BucketColorClasses> = {
  blue: {
    accent: "bg-blue-500",
    badge: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  emerald: {
    accent: "bg-emerald-500",
    badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  violet: {
    accent: "bg-violet-500",
    badge: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  amber: {
    accent: "bg-amber-500",
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  rose: {
    accent: "bg-rose-500",
    badge: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  cyan: {
    accent: "bg-cyan-500",
    badge: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  },
  slate: {
    accent: "bg-slate-400 dark:bg-slate-500",
    badge: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
  },
};

/** Classes for a color token; unknown tokens fall back to slate. */
export function bucketColorClasses(color: string): BucketColorClasses {
  return COLORS[color] ?? COLORS.slate;
}
