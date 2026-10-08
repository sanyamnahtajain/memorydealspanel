"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { springs } from "@/components/motion/tokens";
import { hapticTap } from "@/lib/haptics";

/**
 * CollapsibleSection — a soft-rounded card with a chevron header row, used
 * for the product page's Specs / Description sections.
 *
 * Default state is RESPONSIVE without any client-side viewport read (so the
 * server HTML never mismatches on hydration):
 *   - `open === null` ("auto"): CSS decides — collapsed on phones, expanded
 *     from `md:` up (fast scanning on phones, everything visible on desktop);
 *   - after the first tap the explicit boolean wins on every breakpoint.
 *
 * The expand/collapse animates via the CSS `grid-template-rows` 0fr→1fr
 * trick; the app-wide reduced-motion rules in globals.css zero the
 * transition duration, so no extra JS is needed to respect the preference.
 * The chevron rotates on a spring once the state is explicit (the CSS auto
 * state keeps its breakpoint-driven rotation until the first tap).
 *
 * Price-free by construction — it renders whatever children it is handed.
 */
export interface CollapsibleSectionProps {
  title: string;
  /** Optional decorative glyph rendered before the title. */
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function CollapsibleSection({
  title,
  icon,
  children,
  className,
}: CollapsibleSectionProps) {
  // null = "auto" (CSS default: closed on phones, open on md+).
  const [open, setOpen] = React.useState<boolean | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const contentId = React.useId();
  const reduced = useReducedMotion();

  // While in "auto" state the rendered aria-expanded (false) is only correct
  // below md. Sync the attribute to the EFFECTIVE state straight on the DOM —
  // no setState, no re-render, and it tracks viewport changes.
  React.useEffect(() => {
    if (open !== null) return;
    const el = buttonRef.current;
    if (!el || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => el.setAttribute("aria-expanded", String(mq.matches));
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [open]);

  function toggle() {
    hapticTap();
    setOpen((prev) => {
      // First tap: flip whatever the CSS auto state currently shows.
      const current =
        prev ??
        (typeof window !== "undefined" &&
          typeof window.matchMedia === "function" &&
          window.matchMedia("(min-width: 768px)").matches);
      return !current;
    });
  }

  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-foreground/5",
        className,
      )}
    >
      <h2 className="m-0">
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open ?? false}
          aria-controls={contentId}
          onClick={toggle}
          className="flex min-h-13 w-full items-center justify-between gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset active:bg-muted/60 sm:px-5"
        >
          <span className="flex items-center gap-2.5 font-heading text-[15px] font-semibold tracking-tight text-foreground sm:text-base">
            {icon ? (
              <span aria-hidden className="shrink-0 [&_svg]:size-4.5">
                {icon}
              </span>
            ) : null}
            {title}
          </span>
          {open === null ? (
            // Auto state: CSS decides per breakpoint, no script needed.
            <ChevronDown
              aria-hidden
              className="size-4.5 shrink-0 text-muted-foreground transition-transform duration-200 md:-rotate-180"
            />
          ) : (
            <motion.span
              aria-hidden
              className="grid size-6 shrink-0 place-items-center text-muted-foreground"
              initial={false}
              animate={{ rotate: open ? -180 : 0 }}
              transition={reduced ? { duration: 0 } : springs.snappy}
            >
              <ChevronDown className="size-4.5" />
            </motion.span>
          )}
        </button>
      </h2>
      <div
        id={contentId}
        className={cn(
          "grid transition-[grid-template-rows] duration-300 [transition-timing-function:var(--ease-out)]",
          open === null && "grid-rows-[0fr] md:grid-rows-[1fr]",
          open === true && "grid-rows-[1fr]",
          open === false && "grid-rows-[0fr]",
        )}
      >
        {/* `visibility` (not aria-hidden) keeps collapsed content out of the
            tab order and the a11y tree while letting CSS express the
            per-breakpoint auto state. */}
        <div
          className={cn(
            "min-h-0 overflow-hidden",
            open === null && "invisible md:visible",
            open === true && "visible",
            open === false && "invisible",
          )}
        >
          <div className="px-4 pt-0.5 pb-4 sm:px-5 sm:pb-5">{children}</div>
        </div>
      </div>
    </section>
  );
}
