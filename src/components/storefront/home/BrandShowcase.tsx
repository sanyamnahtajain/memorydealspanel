import Link from "next/link";

import type { PublicBrand } from "@/server/dal/brands";
import { catalogImageUrl } from "@/lib/image-loader";

/**
 * "Shop by brand" — a responsive grid of brand tiles (logo or monogram) that
 * link to the brand landing page (/b/[slug]). Public/price-free.
 */
export function BrandShowcase({
  brands,
  limit = 18,
}: {
  brands: PublicBrand[];
  /** Max tiles shown (home teaser); the full directory lives at /brands. */
  limit?: number;
}) {
  if (brands.length === 0) return null;
  return (
    // PHONES: two rows that scroll sideways. Eighteen brand tiles used to stack
    // into six rows and push "Shop by category" — the retailer's actual jump-
    // off point — a full screen down. Now the brands take two rows and a
    // thumb-swipe shows the rest. FROM md: the familiar grid.
    <div className="-mx-4 grid snap-x snap-proximity auto-cols-[6.75rem] grid-flow-col grid-rows-2 gap-2.5 overflow-x-auto scroll-smooth px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:grid-flow-row md:auto-cols-auto md:grid-cols-6 md:grid-rows-none md:gap-3 md:overflow-visible md:px-0 md:pb-0">
      {brands.slice(0, limit).map((brand) => (
        <Link
          key={brand.id}
          href={`/b/${brand.slug}`}
          className="group md-reveal flex min-h-16 snap-start flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-2 py-3 text-center outline-none transition-[color,background-color,border-color,transform] duration-200 hover:border-primary/40 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
      prefetch={false}>
          {brand.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={catalogImageUrl(brand.logo, 128)}
              alt={brand.name}
              className="h-7 w-auto object-contain"
              loading="lazy"
            />
          ) : (
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 font-heading text-sm font-bold text-primary">
              {brand.name.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="w-full truncate text-xs font-medium text-foreground/80 group-hover:text-foreground">
            {brand.name}
          </span>
        </Link>
      ))}
    </div>
  );
}
