import { cn } from "@/lib/utils";

/**
 * IndependenceBadge — a MINIMAL Independence Day accent beside the logo:
 * three slim vertical tricolor strips with a gentle staggered sway. No flag,
 * no text — just a quiet nod. Self-gated to Aug 1–20 so it retires itself.
 * Pure CSS animation (`md-tricolor-*` in globals.css), honours
 * prefers-reduced-motion.
 */
export function IndependenceBadge({ className }: { className?: string }) {
  const now = new Date();
  if (now.getMonth() !== 7 || now.getDate() > 20) return null; // August 1–20

  return (
    <span
      className={cn("flex shrink-0 items-end gap-[3px] select-none", className)}
      aria-label="Happy Independence Day"
      title="Happy Independence Day"
    >
      <span aria-hidden className="md-tricolor-bar h-4 w-[3px] rounded-full bg-[#FF9933]" />
      <span
        aria-hidden
        className="md-tricolor-bar h-5 w-[3px] rounded-full bg-gradient-to-b from-neutral-100 via-[#000080]/70 to-neutral-100 [animation-delay:0.35s] dark:from-neutral-300 dark:to-neutral-300"
      />
      <span
        aria-hidden
        className="md-tricolor-bar h-4 w-[3px] rounded-full bg-[#138808] [animation-delay:0.7s]"
      />
    </span>
  );
}
