import { slabyHref, type SlabyPlacement } from "@/lib/slaby/branding";
import { cn } from "@/lib/utils";

/**
 * The Slaby script wordmark (from the Slaby brand kit) as an inline SVG.
 * Strokes ride `currentColor`; size with a height class — width follows the
 * 448:196 aspect. Server-safe (no client hooks).
 */
export function SlabyWordmark({ className = "h-4" }: { className?: string }) {
  return (
    <svg
      viewBox="24 24 448 196"
      role="img"
      aria-label="Slaby"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="24"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M 100 96 C 88 78 64 76 52 90 C 40 104 50 118 70 124 C 92 130 102 142 92 156 C 82 170 56 170 44 156" />
      <path d="M 126 160 C 150 140 172 96 170 62 C 169 40 156 34 148 48 C 138 66 140 118 154 146 C 162 162 176 166 188 158" />
      <path d="M 252 106 C 236 92 210 96 200 114 C 190 132 198 156 218 160 C 236 164 252 148 254 128" />
      <path d="M 254 106 C 252 128 252 146 262 158 C 270 167 282 165 290 156" />
      <path d="M 312 44 C 308 84 306 128 310 158" />
      <path d="M 310 116 C 322 98 348 96 358 114 C 368 132 358 156 338 160 C 326 162 316 156 310 146" />
      <path d="M 394 104 C 392 124 394 142 406 154 C 416 163 430 160 438 150" />
      <path d="M 448 104 C 444 140 438 178 420 196 C 406 210 386 206 380 192" />
    </svg>
  );
}

/** The Slaby brand blue (the TradeOS original), lightened a step in dark mode. */
export const SLABY_BLUE_TEXT = "text-[#2563EB] dark:text-[#60A5FA]";

/**
 * "Built with Slaby" badge — a non-blocking attribution link with a little
 * presence: a blue-tinted pill, muted prefix, and the wordmark in the ORIGINAL
 * Slaby blue (owner request — never the page's ink color). Pure presentation:
 * the CALLER decides whether it renders (placement toggles).
 */
export function SlabyBadge({
  placement,
  prefix = "Built with",
  className,
}: {
  placement: SlabyPlacement;
  /** "Built with" (default) or "Powered by" for the order-success screen. */
  prefix?: string;
  className?: string;
}) {
  return (
    <a
      href={slabyHref(placement)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-[#2563EB]/25 bg-[#2563EB]/5 px-3 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:border-[#2563EB]/40 hover:bg-[#2563EB]/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 dark:border-[#60A5FA]/25 dark:bg-[#60A5FA]/10 dark:hover:bg-[#60A5FA]/15",
        className,
      )}
      aria-label={`${prefix} Slaby — opens slaby.in`}
    >
      <span>{prefix}</span>
      <SlabyWordmark className={cn("h-3.5 translate-y-px", SLABY_BLUE_TEXT)} />
    </a>
  );
}
