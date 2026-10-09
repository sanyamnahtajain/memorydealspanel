import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, LayoutGrid } from "lucide-react";

import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/display-case";
import type { CategoryDTO } from "@/server/dal/categories";
import { Stagger } from "@/components/motion/primitives";

interface CategoryGridProps {
  categories: CategoryDTO[];
  className?: string;
  /** When true, entrance is staggered on mount (home page). */
  animated?: boolean;
  /**
   * Home teaser layout: pass up to 12 categories; phones show the first 8 in
   * two columns, md+ shows all 12 (4 → 6 columns). Done with a CSS rule so
   * one DOM serves both widths. The full list lives at /categories.
   */
  teaser?: boolean;
}

/**
 * Responsive grid of category tiles (image + name). Carries NO pricing, so it
 * is safe on ISR/public pages. A server component by default; the optional
 * {@link Stagger} wrapper makes it a client subtree only when `animated`.
 */
export function CategoryGrid({
  categories,
  className,
  animated = false,
  teaser = false,
}: CategoryGridProps) {
  const gridClass = cn(
    "grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4",
    teaser ? "md-teaser-8 md:grid-cols-4 lg:grid-cols-6" : "lg:grid-cols-4",
    className,
  );

  const cards = categories.map((category) => (
    <CategoryCard key={category.id} category={category} />
  ));

  if (animated) {
    return <Stagger className={gridClass}>{cards}</Stagger>;
  }
  return <div className={gridClass}>{cards}</div>;
}

function CategoryCard({ category }: { category: CategoryDTO }) {
  const name = titleCase(category.name);
  return (
    <Link
      href={`/c/${category.slug}`}
      className="group md-reveal relative flex flex-col overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-foreground/5 outline-none transition-[box-shadow,transform] duration-200 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"
      prefetch={false}
    >
      <div className="relative aspect-4/3 w-full overflow-hidden bg-muted/60">
        {category.image ? (
          <Image
            src={category.image}
            alt=""
            fill
            sizes="(min-width: 1024px) 18vw, (min-width: 640px) 30vw, 45vw"
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <LayoutGrid className="size-8" aria-hidden />
          </div>
        )}
        {/* Scrim: keeps the white label legible on any photograph. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-linear-to-t from-foreground/60 via-foreground/10 to-transparent"
        />
      </div>
      {/* Names like "Computer Peripherals" do not fit one line in a 2-column
          phone tile, so the label wraps to two lines (never an ellipsis) and
          the arrow glyph only appears from sm: where there is room for it. */}
      <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 px-3 pb-2.5 pt-6">
        <span className="line-clamp-2 min-w-0 text-[13px] leading-snug font-semibold text-background text-balance sm:text-sm md:text-[15px]">
          {name}
        </span>
        <span
          aria-hidden
          className="md-tile-arrow hidden size-6 shrink-0 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm sm:inline-flex"
        >
          <ArrowUpRight className="size-3.5" />
        </span>
      </span>
    </Link>
  );
}
