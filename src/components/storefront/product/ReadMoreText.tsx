"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * ReadMoreText — the product description body, clamped to a scannable height
 * with a "Read more" toggle when the text is long.
 *
 * "Long" is decided from the TEXT itself (character count / line breaks),
 * not from measured layout — deterministic on the server, so there is no
 * hydration flicker and no measure-then-setState effect. A short description
 * renders as a plain paragraph with no toggle at all.
 *
 * The admin's typed line breaks are preserved (whitespace-pre-line), exactly
 * as the previous description box did.
 */
export interface ReadMoreTextProps {
  text: string;
  className?: string;
}

/** Rough threshold: ~6 clamped lines of body text at phone width. */
const LONG_CHARS = 320;
const LONG_LINES = 6;

export function ReadMoreText({ text, className }: ReadMoreTextProps) {
  const [expanded, setExpanded] = React.useState(false);
  const isLong =
    text.length > LONG_CHARS || text.split("\n").length > LONG_LINES;

  return (
    <div className={className}>
      <p
        className={cn(
          "text-sm leading-relaxed whitespace-pre-line text-foreground/80",
          isLong && !expanded && "line-clamp-6",
        )}
      >
        {text}
      </p>
      {isLong ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 rounded text-sm font-medium text-primary outline-none transition-transform hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      ) : null}
    </div>
  );
}
