import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { Flame, ImageOff } from "lucide-react";

import { trendingProductIds } from "@/server/services/recommendations";
import { listByIdsForViewer } from "@/server/dal/products";
import { ANON_VIEWER } from "@/server/types/viewer";
import { renderPriceSlot } from "@/components/storefront/priceSlot";
import { BrandBadge } from "@/components/storefront/BrandBadge";
import type { PublicProduct, PricedProduct } from "@/server/dto/product";

/**
 * TrendingRail — the self-contained "Trending now" section for the home page.
 *
 * A SERVER component on purpose, so it is ISR-safe on the public home shell:
 *  - it reads NO cookies and branches on NO viewer — products are resolved for
 *    the ANONYMOUS viewer via the gated DAL, exactly like the featured rail;
 *  - PRICE GATE: the trending score and this component's props never carry
 *    money. Every price cell is a server-rendered `renderPriceSlot(product,
 *    ANON_VIEWER)` node — a locked "See price" chip on the shared cache,
 *    correct for every visitor.
 *
 * Ranking comes from `trendingProductIds` (admin pins first, then the surge
 * algorithm — see src/lib/trending.ts for the maths). Renders NOTHING when
 * there is no signal, so a quiet week never shows an empty shelf.
 *
 * Presentation mirrors the house rails: a SectionHeading-style header (with a
 * small flame accent) over a CSS scroll-snap horizontal rail reusing the
 * featured-rail card look. Pure CSS snap — no client JS — so the section adds
 * zero hydration cost to the home page.
 */

/** Rail length — matches the featured rail's 8 so the shelves feel alike. */
const TRENDING_LIMIT = 8;

interface TrendingItem {
  product: PublicProduct | PricedProduct;
  priceSlot: React.ReactNode;
}

export async function TrendingRail() {
  const ids = await trendingProductIds(TRENDING_LIMIT);
  if (ids.length === 0) return null;

  // The DAL keeps the ranked order and silently drops hidden/deleted ids.
  const products = await listByIdsForViewer(ANON_VIEWER, ids);
  if (products.length === 0) return null;

  const items: TrendingItem[] = products.map((product) => ({
    product,
    priceSlot: renderPriceSlot(product, ANON_VIEWER),
  }));

  return (
    <section aria-labelledby="home-trending">
      {/* SectionHeading's exact type treatment, plus the flame accent — the
          shared component takes a plain string title, so the accent lives here. */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2
          id="home-trending"
          className="flex items-center gap-1.5 font-heading text-lg font-bold tracking-tight text-foreground md:text-xl"
        >
          <Flame
            aria-hidden
            className="size-4.5 shrink-0 text-warning md:size-5"
          />
          Trending now
        </h2>
      </div>

      <ul className="grid snap-x snap-proximity auto-cols-[minmax(9.5rem,11.5rem)] grid-flow-col gap-3 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:auto-cols-[minmax(11rem,13rem)] md:gap-4">
        {items.map((item) => (
          <li key={item.product.id} className="snap-start">
            <TrendingCard item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The featured-rail card look, server-rendered (no motion/hydration). */
function TrendingCard({ item }: { item: TrendingItem }) {
  const { product } = item;
  const image =
    product.images.find((img) => img.isPrimary) ?? product.images[0] ?? null;

  return (
    <Link
      href={`/p/${product.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm outline-none transition-shadow focus-visible:ring-3 focus-visible:ring-ring/50 hover:shadow-md active:scale-[0.99]"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {image ? (
          <Image
            src={image.thumbUrl ?? image.url}
            alt={product.name}
            fill
            sizes="(min-width: 768px) 13rem, 45vw"
            className="object-cover transition-transform duration-300 ease-out group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="size-7" aria-hidden />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        {product.brandRef ? (
          <BrandBadge
            name={product.brandRef.name}
            slug={product.brandRef.slug}
            asLink={false}
          />
        ) : product.brand ? (
          <span className="text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
            {product.brand}
          </span>
        ) : null}
        <h3 className="line-clamp-2 text-sm font-semibold text-foreground">
          {product.name}
        </h3>
        <div className="mt-auto pt-2">{item.priceSlot}</div>
      </div>
    </Link>
  );
}
