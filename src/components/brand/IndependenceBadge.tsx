import { cn } from "@/lib/utils";

/**
 * IndependenceBadge — a small STATIC tricolor cockade beside the logo for
 * Independence Day: a saffron/green split ring around a white disc carrying
 * a real 24-spoke Ashoka Chakra. Crisp SVG, no animation, ~20px; self-gated
 * to Aug 1–20 so it retires itself.
 */
export function IndependenceBadge({ className }: { className?: string }) {
  const now = new Date();
  if (now.getMonth() !== 7 || now.getDate() > 20) return null; // August 1–20

  return (
    <span
      className={cn("flex shrink-0 items-center select-none", className)}
      aria-label="Happy Independence Day"
      title="Happy Independence Day"
    >
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
        {/* White disc — the flag's white band; keeps the chakra crisp on any theme. */}
        <circle cx="12" cy="12" r="6.9" className="fill-white" />
        {/* Saffron top arc / green bottom arc, rounded caps for soft gaps. */}
        <path
          d="M 3.56 10.36 A 8.6 8.6 0 0 1 20.44 10.36"
          fill="none"
          stroke="#FF9933"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M 3.56 13.64 A 8.6 8.6 0 0 0 20.44 13.64"
          fill="none"
          stroke="#138808"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        {/* Ashoka Chakra — rim, 24 spokes, hub. */}
        <circle cx="12" cy="12" r="4.3" fill="none" stroke="#000080" strokeWidth="0.9" />
        <line x1="13.5" y1="12.0" x2="15.9" y2="12.0" stroke="#000080" strokeWidth="0.55" />
          <line x1="13.45" y1="11.61" x2="15.77" y2="10.99" stroke="#000080" strokeWidth="0.55" />
          <line x1="13.3" y1="11.25" x2="15.38" y2="10.05" stroke="#000080" strokeWidth="0.55" />
          <line x1="13.06" y1="10.94" x2="14.76" y2="9.24" stroke="#000080" strokeWidth="0.55" />
          <line x1="12.75" y1="10.7" x2="13.95" y2="8.62" stroke="#000080" strokeWidth="0.55" />
          <line x1="12.39" y1="10.55" x2="13.01" y2="8.23" stroke="#000080" strokeWidth="0.55" />
          <line x1="12.0" y1="10.5" x2="12.0" y2="8.1" stroke="#000080" strokeWidth="0.55" />
          <line x1="11.61" y1="10.55" x2="10.99" y2="8.23" stroke="#000080" strokeWidth="0.55" />
          <line x1="11.25" y1="10.7" x2="10.05" y2="8.62" stroke="#000080" strokeWidth="0.55" />
          <line x1="10.94" y1="10.94" x2="9.24" y2="9.24" stroke="#000080" strokeWidth="0.55" />
          <line x1="10.7" y1="11.25" x2="8.62" y2="10.05" stroke="#000080" strokeWidth="0.55" />
          <line x1="10.55" y1="11.61" x2="8.23" y2="10.99" stroke="#000080" strokeWidth="0.55" />
          <line x1="10.5" y1="12.0" x2="8.1" y2="12.0" stroke="#000080" strokeWidth="0.55" />
          <line x1="10.55" y1="12.39" x2="8.23" y2="13.01" stroke="#000080" strokeWidth="0.55" />
          <line x1="10.7" y1="12.75" x2="8.62" y2="13.95" stroke="#000080" strokeWidth="0.55" />
          <line x1="10.94" y1="13.06" x2="9.24" y2="14.76" stroke="#000080" strokeWidth="0.55" />
          <line x1="11.25" y1="13.3" x2="10.05" y2="15.38" stroke="#000080" strokeWidth="0.55" />
          <line x1="11.61" y1="13.45" x2="10.99" y2="15.77" stroke="#000080" strokeWidth="0.55" />
          <line x1="12.0" y1="13.5" x2="12.0" y2="15.9" stroke="#000080" strokeWidth="0.55" />
          <line x1="12.39" y1="13.45" x2="13.01" y2="15.77" stroke="#000080" strokeWidth="0.55" />
          <line x1="12.75" y1="13.3" x2="13.95" y2="15.38" stroke="#000080" strokeWidth="0.55" />
          <line x1="13.06" y1="13.06" x2="14.76" y2="14.76" stroke="#000080" strokeWidth="0.55" />
          <line x1="13.3" y1="12.75" x2="15.38" y2="13.95" stroke="#000080" strokeWidth="0.55" />
          <line x1="13.45" y1="12.39" x2="15.77" y2="13.01" stroke="#000080" strokeWidth="0.55" />
        <circle cx="12" cy="12" r="0.95" fill="#000080" />
      </svg>
    </span>
  );
}
