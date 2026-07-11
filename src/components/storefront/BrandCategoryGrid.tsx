import Link from "next/link";
import Image from "next/image";
import { LayoutGrid } from "lucide-react";

import type { BrandCategory } from "@/server/dal/brands";

/**
 * Category tiles for a brand landing page — each links into the
 * brand → category → products drill-down (`/b/[brand]/[category]`) and shows
 * the brand-scoped product count. Carries NO pricing (counts are public).
 */
export function BrandCategoryGrid({
  brandSlug,
  categories,
}: {
  brandSlug: string;
  categories: BrandCategory[];
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
      {categories.map((category) => (
        <Link
          key={category.id}
          href={`/b/${brandSlug}/${category.slug}`}
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
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-2.5">
            <span className="truncate text-sm font-medium text-foreground">
              {category.name}
            </span>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
              {category.count}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
