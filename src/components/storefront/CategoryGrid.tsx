import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { LayoutGrid } from "lucide-react";

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
   * Home teaser: end the grid with an "All categories" tile linking here.
   * Shows 11 categories + the tile on phones/tablets (3x4, 2x6) and 15 + the
   * tile on laptops (2x8), so every row is full and the last cell is "All".
   */
  allHref?: string;
}

const TEASER_SMALL = 11;
const TEASER_WIDE = 15;

/**
 * Category tiles in Blinkit's style: four across on a phone (six on a tablet,
 * eight on a laptop), each a soft blue-grey square holding the category's
 * photo with a two-line name underneath — a whole catalogue's worth of entry
 * points in one thumb-height. Carries NO pricing, so it is safe on ISR/public
 * pages. A server component by default; the optional {@link Stagger} wrapper
 * makes it a client subtree only when `animated`.
 */
export function CategoryGrid({ categories, className, animated = false, allHref }: CategoryGridProps) {
  const teaser = allHref !== undefined;
  const shown = teaser ? categories.slice(0, TEASER_WIDE) : categories;
  const gridClass = cn(
    "grid grid-cols-4 gap-x-2.5 gap-y-4 sm:grid-cols-6 sm:gap-x-3 lg:grid-cols-8",
    // Below laptop width only 11 categories + the "All" tile (the grid's
    // direct children — tiles or their animation wrappers).
    teaser && "max-lg:[&>*:nth-child(n+12):not(:last-child)]:hidden",
    className,
  );

  const tiles = shown.map((category) => (
    <CategoryTile key={category.id} category={category} />
  ));
  if (teaser) {
    tiles.push(
      <AllCategoriesTile
        key="all"
        href={allHref}
        total={categories.length}
        // Peek at what's behind the tile: the categories not on the grid.
        preview={
          categories.length > TEASER_WIDE + 3
            ? categories.slice(TEASER_WIDE, TEASER_WIDE + 4)
            : categories.length > TEASER_SMALL + 3
              ? categories.slice(TEASER_SMALL, TEASER_SMALL + 4)
              : categories.slice(0, 4)
        }
      />,
    );
  }

  if (animated) {
    return <Stagger className={gridClass}>{tiles}</Stagger>;
  }
  return <div className={gridClass}>{tiles}</div>;
}

function CategoryTile({ category }: { category: CategoryDTO }) {
  const name = titleCase(category.name);
  return (
    <Link
      href={`/c/${category.slug}`}
      className="group md-reveal flex flex-col items-center gap-1.5 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.96]"
      prefetch={false}
    >
      <span className="md-tile relative aspect-square w-full overflow-hidden rounded-2xl transition-shadow duration-200 group-hover:shadow-md">
        {category.image ? (
          <Image
            src={category.image}
            alt=""
            fill
            sizes="(min-width: 1024px) 10vw, (min-width: 640px) 15vw, 23vw"
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-muted-foreground">
            <LayoutGrid className="size-6" aria-hidden />
          </span>
        )}
      </span>
      <span className="line-clamp-2 w-full text-center text-[12px] leading-tight font-semibold text-foreground sm:text-[13px]">
        {name}
      </span>
    </Link>
  );
}

/** The grid's last cell: a 2x2 peek at more categories, "All categories". */
function AllCategoriesTile({
  href,
  total,
  preview,
}: {
  href: string;
  total: number;
  preview: CategoryDTO[];
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-label={`All ${total} categories`}
      className="group md-reveal flex flex-col items-center gap-1.5 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.96]"
    >
      <span className="md-tile relative grid aspect-square w-full grid-cols-2 gap-1 overflow-hidden rounded-2xl p-1.5 transition-shadow duration-200 group-hover:shadow-md">
        {preview.map((c) => (
          <span key={c.id} className="relative overflow-hidden rounded-lg bg-background/60">
            {c.image ? (
              <Image src={c.image} alt="" fill sizes="12vw" className="object-cover" />
            ) : null}
          </span>
        ))}
        <span className="absolute inset-x-1.5 bottom-1.5 rounded-lg bg-foreground/80 py-0.5 text-center text-[11px] font-semibold text-background backdrop-blur-sm sm:text-xs">
          {/* Phones/tablets show 11 categories, laptops 15. */}
          <span className="lg:hidden">{total > TEASER_SMALL ? `+${total - TEASER_SMALL} more` : "See all"}</span>
          <span className="hidden lg:inline">
            {total > TEASER_WIDE ? `+${total - TEASER_WIDE} more` : "See all"}
          </span>
        </span>
      </span>
      <span className="line-clamp-2 w-full text-center text-[12px] leading-tight font-semibold text-primary sm:text-[13px]">
        All categories
      </span>
    </Link>
  );
}
