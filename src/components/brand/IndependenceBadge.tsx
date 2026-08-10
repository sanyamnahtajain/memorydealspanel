import { cn } from "@/lib/utils";

/**
 * IndependenceBadge — a compact animated tricolor that sits beside the logo
 * around Independence Day (self-gated to Aug 1–20, so it retires itself).
 *
 * A tiny fluttering flag: pole + three stripes with a slowly turning Ashoka
 * Chakra, plus a "Jai Hind 🇮🇳" whisper from sm up. Pure CSS animation
 * (`md-flag-wave` / `md-chakra-spin` in globals.css) — zero JS, honours
 * prefers-reduced-motion, and stays legible at header sizes on phones.
 */
export function IndependenceBadge({ className }: { className?: string }) {
  const now = new Date();
  if (now.getMonth() !== 7 || now.getDate() > 20) return null; // August 1–20

  return (
    <span
      className={cn("flex shrink-0 items-center gap-1.5 select-none", className)}
      aria-label="Happy Independence Day"
      title="Happy Independence Day"
    >
      {/* Pole + fluttering flag */}
      <span className="flex items-start" aria-hidden>
        <span className="h-6 w-[2px] rounded-full bg-gradient-to-b from-amber-700 to-amber-900 dark:from-amber-500 dark:to-amber-700" />
        <span className="md-flag mt-[1px] origin-left overflow-hidden rounded-r-[3px] shadow-sm">
          <span className="block h-[5px] w-6 bg-[#FF9933]" />
          <span className="relative block h-[5px] w-6 bg-white">
            <svg
              viewBox="0 0 24 24"
              className="md-chakra absolute top-1/2 left-1/2 size-[5px] -translate-x-1/2 -translate-y-1/2"
            >
              <circle cx="12" cy="12" r="10" fill="none" stroke="#000080" strokeWidth="2.5" />
              {Array.from({ length: 12 }, (_, i) => (
                <line
                  key={i}
                  x1="12"
                  y1="12"
                  x2={12 + 10 * Math.cos((i * Math.PI) / 6)}
                  y2={12 + 10 * Math.sin((i * Math.PI) / 6)}
                  stroke="#000080"
                  strokeWidth="1.6"
                />
              ))}
            </svg>
          </span>
          <span className="block h-[5px] w-6 bg-[#138808]" />
        </span>
      </span>

      {/* Whisper — tricolor shimmer, hidden on the tightest screens */}
      <span className="md-jai-hind hidden text-[0.65rem] leading-none font-semibold tracking-wide whitespace-nowrap sm:inline">
        Jai&nbsp;Hind
      </span>
    </span>
  );
}
