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
 * PHONES: ONE row of compact logo chips in a snap rail, the next chip
 * peeking past the gutter, so the brand strip costs ~3rem of height and
 * "Shop by category" stays on the first screen. Eighteen stacked boxes used
 * to push it a full screen down.
 *
 * FROM md: a tidy 6-column grid capped at `limit` tiles (about two rows);
 * when the master holds more, the last cell is an "All brands" tile. Logos
 * sit on hairline-ring tiles, grayscale until hovered.
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

  return (
    <ul
      aria-label="Brands"
      className={cn(
        // Phones: one-row snap rail, bleeding into the 16px gutters.
        "-mx-4 flex snap-x snap-proximity gap-2 overflow-x-auto scroll-smooth px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        // md+: grid, no scrolling.
        "md:mx-0 md:grid md:grid-cols-6 md:gap-3 md:overflow-visible md:px-0 md:pb-0",
        className,
      )}
    >
      {shown.map((brand) => (
        <li key={brand.id} className="shrink-0 snap-start md:min-w-0">
          <Link
            href={`/b/${brand.slug}`}
            prefetch={false}
            className={cn(
              "group md-reveal flex items-center outline-none ring-1 ring-foreground/5 transition-[background-color,box-shadow,transform] duration-200 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]",
              // Chip on phones…
              "min-h-11 gap-2 rounded-full bg-card px-3 py-1.5 shadow-xs",
              // …tile on md+.
              "md:min-h-0 md:flex-col md:justify-center md:gap-2 md:rounded-2xl md:px-3 md:py-4 md:shadow-none md:hover:-translate-y-0.5 md:hover:shadow-md",
            )}
          >
            {brand.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={catalogImageUrl(brand.logo, 128)}
                alt=""
                className="h-5 w-auto max-w-16 object-contain mix-blend-multiply md:h-8 md:max-w-24 md:grayscale md:transition-[filter] md:duration-300 md:group-hover:grayscale-0"
                loading="lazy"
              />
            ) : (
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-heading text-xs font-bold text-primary md:size-9 md:rounded-xl md:text-sm">
                {brand.name.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="max-w-32 truncate text-xs font-medium text-foreground/85 group-hover:text-foreground md:w-full md:max-w-none md:text-center">
              {titleCase(brand.name)}
            </span>
          </Link>
        </li>
      ))}

      {overflow > 0 ? (
        <li className="shrink-0 snap-start md:min-w-0">
          <Link
            href={allHref}
            prefetch={false}
            className={cn(
              "group md-reveal flex items-center outline-none ring-1 ring-foreground/10 transition-[background-color,transform] duration-200 ease-out hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]",
              "min-h-11 gap-1.5 rounded-full bg-muted/60 px-3.5 py-1.5",
              "md:h-full md:min-h-0 md:flex-col md:justify-center md:gap-1 md:rounded-2xl md:px-3 md:py-4",
            )}
          >
            <span className="text-xs font-semibold text-foreground">
              +{overflow} more
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
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
