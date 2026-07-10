import * as React from "react";
import { LockIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import "./shimmer.css";

/**
 * Formats integer paise as Indian rupees with en-IN digit grouping.
 * 49950 → "₹499.50" · 5000000 → "₹50,000" · -12345 → "−₹123.45"
 */
export function formatPaise(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const fraction = abs % 100;
  const grouped = rupees.toLocaleString("en-IN");
  const body =
    fraction === 0 ? grouped : `${grouped}.${String(fraction).padStart(2, "0")}`;
  return `${negative ? "−" : ""}₹${body}`;
}

const SIZE_CLASSES = {
  sm: "h-6 gap-1 px-2 text-xs [&_svg]:size-3",
  md: "h-7 gap-1.5 px-2.5 text-sm [&_svg]:size-3.5",
  lg: "h-9 gap-1.5 px-3.5 text-base [&_svg]:size-4",
} as const;

type PricePillSize = keyof typeof SIZE_CLASSES;

type PricePillProps = {
  size?: PricePillSize;
  className?: string;
} & (
  | {
      /** Price in integer paise (49950 = ₹499.50). */
      paise: number;
      variant?: "default";
    }
  | {
      /**
       * Gated price: renders a blurred shimmering placeholder with a lock
       * icon — no real amount is needed (or should ever be passed) here.
       * This is the visual seed for the storefront PriceGate.
       */
      variant: "locked";
      paise?: undefined;
    }
);

/**
 * Price display pill with tabular numerals. The `locked` variant shows a
 * blurred shimmer placeholder instead of an amount. Server component.
 */
export function PricePill(props: PricePillProps) {
  const { size = "md", className } = props;

  if (props.variant === "locked") {
    return (
      <span
        data-slot="price-pill"
        data-variant="locked"
        role="img"
        aria-label="Price hidden — approval required"
        className={cn(
          "md-shimmer inline-flex w-fit shrink-0 items-center rounded-full border border-border font-tabular font-medium text-muted-foreground select-none",
          SIZE_CLASSES[size],
          className
        )}
      >
        <LockIcon aria-hidden className="shrink-0" />
        <span aria-hidden className="blur-[5px]">
          {"₹"}
          {"•,•••"}
        </span>
      </span>
    );
  }

  return (
    <span
      data-slot="price-pill"
      data-variant="default"
      className={cn(
        "inline-flex w-fit shrink-0 items-center rounded-full border border-border bg-secondary font-tabular font-semibold text-secondary-foreground",
        SIZE_CLASSES[size],
        className
      )}
    >
      {formatPaise(props.paise)}
    </span>
  );
}
