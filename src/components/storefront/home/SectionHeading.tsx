import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * SectionHeading — a consistent home-section header with an optional "see all"
 * link. Pure server component, no data.
 */
interface SectionHeadingProps {
  id: string;
  title: string;
  /** Optional link rendered on the right (e.g. "See all → /search"). */
  seeAllHref?: string;
  seeAllLabel?: string;
}

export function SectionHeading({
  id,
  title,
  seeAllHref,
  seeAllLabel = "See all",
}: SectionHeadingProps) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2
        id={id}
        className="font-heading text-lg font-bold tracking-tight text-foreground md:text-xl"
      >
        {title}
      </h2>
      {seeAllHref ? (
        <Link
          href={seeAllHref}
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-primary outline-none transition-colors hover:text-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {seeAllLabel}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}
