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
}

/**
 * Category tiles in Blinkit's style: four across on a phone (six on a tablet,
 * eight on a laptop), each a soft blue-grey square holding the category's
 * photo with a two-line name underneath — a whole catalogue's worth of entry
 * points in one thumb-height. Carries NO pricing, so it is safe on ISR/public
 * pages. A server component by default; the optional {@link Stagger} wrapper
 * makes it a client subtree only when `animated`.
 */
export function CategoryGrid({ categories, className, animated = false }: CategoryGridProps) {
  const gridClass = cn(
    "grid grid-cols-4 gap-x-2.5 gap-y-4 sm:grid-cols-6 sm:gap-x-3 lg:grid-cols-8",
    className,
  );

  const tiles = categories.map((category) => (
    <CategoryTile key={category.id} category={category} />
  ));

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
