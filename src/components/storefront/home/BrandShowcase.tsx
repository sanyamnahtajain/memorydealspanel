import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { PublicBrand } from "@/server/dal/brands";
import { catalogImageUrl } from "@/lib/image-loader";
import { titleCase } from "@/lib/display-case";
import { cn } from "@/lib/utils";

/**
 * "Shop by brand" — brand tiles (logo or monogram) linking to /b/[slug].
 * Public/price-free, pure server component.
 *
 * PHONES: two rows of proper logo tiles in a snap rail (the next column
 * peeking past the gutter), so the strip is one thumb-swipe tall and
 * "Shop by category" is never pushed a screen down.
 *
 * FROM md: the classic 6-column logo grid capped at `limit` tiles; when the
 * master holds more, the last cell is an "All brands" tile.
 */
export function BrandShowcase({
  brands,
  limit = 12,
  allHref = "/brands",
  className,
}: {
  brands: PublicBrand[];
  /** Max tiles shown (home teaser); the full directory lives at /brands. */
  limit?: number;
  /** Where the overflow tile points. */
  allHref?: string;
  className?: string;
}) {
  if (brands.length === 0) return null;
  const shown = brands.slice(0, limit);
  const overflow = brands.length - shown.length;

  const tile =
    "group md-reveal flex min-h-[5.5rem] flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card px-2 py-3 text-center outline-none transition-[border-color,background-color,transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]";

  return (
    <ul
      aria-label="Brands"
      className={cn(
        // Phones: 2-row snap rail bleeding into the 16px gutters.
        "-mx-4 grid snap-x snap-proximity auto-cols-[7rem] grid-flow-col grid-rows-2 gap-2.5 overflow-x-auto scroll-smooth px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        // md+: grid, no scrolling.
        "md:mx-0 md:grid-flow-row md:auto-cols-auto md:grid-cols-6 md:grid-rows-none md:gap-3 md:overflow-visible md:px-0 md:pb-0",
        className,
      )}
    >
      {shown.map((brand) => (
        <li key={brand.id} className="snap-start md:min-w-0">
          <Link href={`/b/${brand.slug}`} prefetch={false} className={tile}>
            {brand.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={catalogImageUrl(brand.logo, 160)}
                alt=""
                className="h-8 w-auto max-w-20 object-contain mix-blend-multiply md:h-9 md:max-w-24"
                loading="lazy"
              />
            ) : (
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-heading text-sm font-bold text-primary">
                {brand.name.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="w-full truncate text-xs font-medium text-foreground/85 group-hover:text-foreground">
              {titleCase(brand.name)}
            </span>
          </Link>
        </li>
      ))}

      {overflow > 0 ? (
        <li className="snap-start md:min-w-0">
          <Link
            href={allHref}
            prefetch={false}
            className={cn(tile, "border-dashed bg-muted/40 hover:bg-muted/70")}
          >
            <span className="text-sm font-semibold text-foreground">
              +{overflow} more
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary">
              All brands
              <ArrowRight
                className="size-3 transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden
              />
            </span>
          </Link>
        </li>
      ) : null}
    </ul>
  );
}
