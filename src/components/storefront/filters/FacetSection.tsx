"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { usePreferences } from "@/components/preferences/PreferencesProvider";

/**
 * A collapsible facet group: a header button (title + optional active-count
 * badge + chevron) over a content region. Custom disclosure — no native
 * `<details>` — so it can animate and match the design system. Respects the
 * reduced-motion preference: when set, the chevron rotation and content reveal
 * are instant.
 */
export interface FacetSectionProps {
  title: string;
  /** Number of active selections in this section (shown as a pill). */
  activeCount?: number;
  /** Start collapsed. @default false */
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}

export function FacetSection({
  title,
  activeCount = 0,
  defaultCollapsed = false,
  children,
}: FacetSectionProps) {
  const { reduceMotion } = usePreferences();
  const [open, setOpen] = React.useState(!defaultCollapsed);
  const contentId = React.useId();

  return (
    <section className="border-b border-border/70 py-3 last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {activeCount > 0 ? (
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-medium tabular-nums text-primary">
            {activeCount}
          </span>
        ) : null}
        <ChevronDown
          aria-hidden
          className={cn(
            "ml-auto size-4 text-muted-foreground",
            !reduceMotion && "transition-transform duration-200",
            open ? "rotate-180" : "rotate-0",
          )}
        />
      </button>
      {open ? (
        <div id={contentId} className="mt-1.5 space-y-0.5">
          {children}
        </div>
      ) : null}
    </section>
  );
}
