import Link from "next/link";
import { ArrowRight, SlidersHorizontal } from "lucide-react";

/**
 * The home page's closing invitation: the shelves above are a sample, the
 * whole catalogue with its filters is one tap away. Pure server component.
 */
export function CatalogCta() {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
      <div className="min-w-0">
        <h2 className="font-heading text-lg font-bold tracking-tight text-foreground md:text-xl">
          Browse the full catalogue
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Filter by brand, category, stock and specs. Everything we carry, in one list.
        </p>
      </div>
      <Link
        href="/search"
        prefetch={false}
        className="group inline-flex min-h-11 w-fit shrink-0 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm outline-none transition-[transform,background-color] duration-200 hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]"
      >
        <SlidersHorizontal aria-hidden className="size-4" />
        Filter &amp; sort
        <ArrowRight aria-hidden className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}
