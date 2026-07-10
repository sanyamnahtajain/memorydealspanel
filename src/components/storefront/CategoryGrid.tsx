import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { LayoutGrid } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CategoryDTO } from "@/server/dal/categories";
import { Stagger } from "@/components/motion/primitives";

interface CategoryGridProps {
  categories: CategoryDTO[];
  className?: string;
  /** When true, entrance is staggered on mount (home page). */
  animated?: boolean;
}

/**
 * Responsive grid of category cards (image + name). Carries NO pricing, so it
 * is safe on ISR/public pages. A server component by default; the optional
 * {@link Stagger} wrapper makes it a client subtree only when `animated`.
 */
export function CategoryGrid({
  categories,
  className,
  animated = false,
}: CategoryGridProps) {
  const gridClass = cn(
    "grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4",
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
  return (
    <Link
      href={`/c/${category.slug}`}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm outline-none transition-shadow focus-visible:ring-3 focus-visible:ring-ring/50 hover:shadow-md active:scale-[0.98]"
    >
      <div className="relative aspect-4/3 w-full overflow-hidden bg-muted">
        {category.image ? (
          <Image
            src={category.image}
            alt=""
            fill
            sizes="(min-width: 1024px) 22vw, (min-width: 640px) 30vw, 45vw"
            className="object-cover transition-transform duration-300 ease-out group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <LayoutGrid className="size-8" aria-hidden />
          </div>
        )}
        <div
          aria-hidden
          className="absolute inset-0 bg-linear-to-t from-foreground/45 via-foreground/0 to-transparent"
        />
      </div>
      <span className="absolute inset-x-0 bottom-0 truncate px-3 py-2.5 text-sm font-semibold text-background">
        {category.name}
      </span>
    </Link>
  );
}
