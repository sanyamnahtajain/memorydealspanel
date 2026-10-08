import type * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * SectionHeading — the storefront's one section header pattern:
 *
 *   EYEBROW (small, tracked, uppercase, muted)
 *   Title (bold, tight tracking, 2xl → 3xl)                   [ See all → ]
 *   Optional one-line muted subtitle
 *
 * Pure server component, no data. `eyebrow` and `subtitle` are optional so
 * every existing caller (`id` + `title` + optional see-all) keeps working and
 * simply inherits the new type scale.
 */
interface SectionHeadingProps {
  id: string;
  title: string;
  /**
   * Small uppercase label above the title ("Browse", "Moving fast"). A node
   * is allowed so a caller can lead with a small glyph (TrendingRail's flame).
   */
  eyebrow?: React.ReactNode;
  /** One muted line under the title. Keep it to a single sentence. */
  subtitle?: string;
  /** Optional link rendered on the right (e.g. "See all → /search"). */
  seeAllHref?: string;
  seeAllLabel?: string;
  className?: string;
}

export function SectionHeading({
  id,
  title,
  eyebrow,
  subtitle,
  seeAllHref,
  seeAllLabel = "See all",
  className,
}: SectionHeadingProps) {
  return (
    <div
      className={cn(
        "mb-5 flex items-end justify-between gap-4 md:mb-6",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="md-eyebrow mb-1.5 flex items-center gap-1.5">{eyebrow}</p>
        ) : null}
        <h2
          id={id}
          className="font-heading text-2xl font-bold tracking-tight text-balance text-foreground md:text-3xl"
        >
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1.5 line-clamp-2 text-sm text-pretty text-muted-foreground md:text-[15px]">
            {subtitle}
          </p>
        ) : null}
      </div>
      {seeAllHref ? (
        <Link
          href={seeAllHref}
          className="group/see inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-muted/70 px-4 text-sm font-medium text-foreground outline-none ring-1 ring-foreground/5 transition-[background-color,transform] duration-200 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
          prefetch={false}
        >
          {seeAllLabel}
          <ArrowRight
            className="size-4 transition-transform duration-200 group-hover/see:translate-x-0.5"
            aria-hidden
          />
        </Link>
      ) : null}
    </div>
  );
}
