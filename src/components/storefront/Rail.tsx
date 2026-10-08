"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A horizontal, snap-scrolling rail with laptop affordances.
 *
 * On a phone the rail is a thumb gesture and needs nothing. On a laptop a
 * horizontal list is DEAD to a mouse — no scrollbar is shown, shift+wheel is
 * folklore — so the content past the right edge may as well not exist. This
 * adds prev/next arrows (md and up, only while there is somewhere to go) and
 * fades the edges where the list continues, so the overflow reads as "more",
 * not "cut off". Arrow keys work when the rail has focus.
 *
 * The children are the rail's `<li>`s, server-rendered; this wrapper owns only
 * the scroll element and the chrome around it.
 */
export function Rail({
  children,
  className,
  listClassName,
  ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  /** Classes for the scrolling <ul> (columns, gaps, snap). */
  listClassName: string;
  ariaLabel?: string;
}) {
  const listRef = React.useRef<HTMLUListElement | null>(null);
  const [edges, setEdges] = React.useState({ start: true, end: true });

  const measure = React.useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft >= max - 2 });
  }, []);

  React.useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro?.disconnect();
    };
  }, [measure]);

  const page = (direction: 1 | -1) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: "smooth" });
  };

  const overflowing = !(edges.start && edges.end);

  return (
    <div className={cn("group/rail relative", className)}>
      <ul
        ref={listRef}
        aria-label={ariaLabel}
        tabIndex={overflowing ? 0 : undefined}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            page(1);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            page(-1);
          }
        }}
        className={cn(
          "outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          // Fade only where there is more to see.
          overflowing && !edges.start && !edges.end && "md:rail-fade-x",
          overflowing && edges.start && !edges.end && "md:rail-fade-end",
          overflowing && !edges.start && edges.end && "md:rail-fade-start",
          listClassName,
        )}
      >
        {children}
      </ul>
      {overflowing ? (
        <>
          <RailArrow side="start" hidden={edges.start} onClick={() => page(-1)} />
          <RailArrow side="end" hidden={edges.end} onClick={() => page(1)} />
        </>
      ) : null}
    </div>
  );
}

function RailArrow({
  side,
  hidden,
  onClick,
}: {
  side: "start" | "end";
  hidden: boolean;
  onClick: () => void;
}) {
  const Icon = side === "start" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={side === "start" ? "Scroll back" : "Scroll forward"}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : 0}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 z-10 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/95 text-foreground shadow-md backdrop-blur transition-all duration-200 ease-out hover:bg-background md:flex",
        "opacity-0 group-hover/rail:opacity-100 focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50",
        side === "start" ? "-left-3" : "-right-3",
        hidden && "pointer-events-none !opacity-0",
      )}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}
