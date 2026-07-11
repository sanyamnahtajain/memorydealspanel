import Link from "next/link";

import type { PublicBrand } from "@/server/dal/brands";

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
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
      {brands.slice(0, limit).map((brand) => (
        <Link
          key={brand.id}
          href={`/b/${brand.slug}`}
          className="group flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-2 py-3 text-center outline-none transition-colors hover:border-primary/40 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {brand.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logo}
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
