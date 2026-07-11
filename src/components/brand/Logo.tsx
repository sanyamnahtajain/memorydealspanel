import Image from "next/image";

import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";

interface LogoProps {
  /** Pixel size of the square logo mark. */
  size?: number;
  /** Show the "The Memory Deals" wordmark beside the mark. */
  withWordmark?: boolean;
  /**
   * Force the white rounded chip in BOTH themes (e.g. a light admin top bar).
   * Even without it, the mark auto-gets the chip in dark mode — the source PNG
   * is a dark-blue/red lockup on transparency, so it would otherwise vanish on
   * any dark surface (header, footer, hero).
   */
  chip?: boolean;
  className?: string;
  wordmarkClassName?: string;
}

/**
 * The Memory Deals (TMD) brand mark. The source PNG is a full lockup; at small
 * sizes it reads as the "TMD" monogram, so pair it with the wordmark in headers.
 */
export function Logo({
  size = 32,
  withWordmark = false,
  chip = false,
  className,
  wordmarkClassName,
}: LogoProps) {
  const mark = (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg",
        // Explicit chip → white backing in both themes. Otherwise the mark
        // stays bare in light mode (dark logo reads fine on light surfaces)
        // and auto-chips in dark mode so it never disappears.
        chip
          ? "bg-white p-1 ring-1 ring-black/5"
          : "dark:bg-white dark:p-1 dark:ring-1 dark:ring-black/5",
        className,
      )}
    >
      <Image
        src="/brand/logo.png"
        alt={APP_NAME}
        width={size}
        height={size}
        priority
        className="object-contain"
        style={{ width: size, height: size }}
      />
    </span>
  );

  if (!withWordmark) return mark;

  return (
    <span className="inline-flex items-center gap-2">
      {mark}
      <span
        className={cn(
          "font-heading font-bold leading-none tracking-tight",
          wordmarkClassName,
        )}
      >
        The Memory Deals
      </span>
    </span>
  );
}
