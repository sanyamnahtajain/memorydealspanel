import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, LayoutGrid } from "lucide-react";

import { listActive } from "@/server/dal/categories";
import { listForViewer } from "@/server/dal/products";
import { ANON_VIEWER } from "@/server/types/viewer";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { FadeUp } from "@/components/motion/primitives";
import { CategoryGrid } from "@/components/storefront/CategoryGrid";
import { HomeSections } from "@/components/storefront/HomeSections";
import {
  GALLERY_HERO_CLASS,
  galleryTransitionName,
} from "@/components/storefront/ProductGallery";
import { renderPriceSlot } from "@/components/storefront/priceSlot";
import type { ProductCardItem } from "@/components/storefront/ProductCardGrid";

export const metadata: Metadata = {
  title: "MemoryDeals — Wholesale memory & storage catalogue",
  description:
    "Browse the MemoryDeals wholesale catalogue of memory, storage and components. Approved buyers unlock live trade pricing.",
};

/**
 * Home is a PUBLIC, price-free teaser and is served via ISR. The featured
 * strip is rendered for the anonymous viewer on purpose: the cached shell must
 * never embed a real price, and locked pills are correct for every visitor of
 * a shared cache entry. Live pricing is unlocked on the category, product and
 * search surfaces, which branch on the real viewer.
 *
 * INTEGRATOR NOTE: if you want approved customers to see live prices on the
 * home teaser too, split the featured strip into its own dynamic segment /
 * client fetch — do NOT relax this page's ISR, or a cached anon render could
 * be served to an approved viewer (and vice-versa).
 */
export const revalidate = 300;

const FEATURED_LIMIT = 8;

export default async function HomePage() {
  const [categories, featured] = await Promise.all([
    listActive(),
    listForViewer(ANON_VIEWER, { take: FEATURED_LIMIT }),
  ]);

  const featuredItems: ProductCardItem[] = featured.map((product) => ({
    product,
    priceSlot: renderPriceSlot(product, ANON_VIEWER),
  }));

  return (
    <StorefrontShell>
      <FadeUp>
        <section className="relative mt-2 overflow-hidden rounded-2xl border border-border bg-linear-to-br from-primary/10 via-card to-card p-6 shadow-sm md:p-10">
          <div className="max-w-xl">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">
              <LayoutGrid className="size-3.5" aria-hidden />
              Wholesale catalogue
            </span>
            <h1 className="mt-4 font-heading text-2xl font-bold tracking-tight text-balance text-foreground md:text-4xl">
              Memory, storage &amp; components at trade prices
            </h1>
            <p className="mt-3 text-pretty text-muted-foreground md:text-lg">
              Browse the full range. Get approved to unlock live wholesale
              pricing across every product.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/search"
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm outline-none transition-[background-color,transform] hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
              >
                Browse catalogue
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <Link
                href="/account"
                className="inline-flex min-h-11 items-center rounded-full border border-border bg-background px-5 text-sm font-semibold text-foreground shadow-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
              >
                Get access
              </Link>
            </div>
          </div>
        </section>
      </FadeUp>

      <HomeSections>
        <section aria-labelledby="home-categories">
          <div className="mb-3 flex items-center justify-between">
            <h2
              id="home-categories"
              className="font-heading text-lg font-bold tracking-tight text-foreground"
            >
              Shop by category
            </h2>
          </div>
          <CategoryGrid categories={categories} />
        </section>

        {featuredItems.length > 0 ? (
          <section aria-labelledby="home-featured">
            <div className="mb-3 flex items-center justify-between">
              <h2
                id="home-featured"
                className="font-heading text-lg font-bold tracking-tight text-foreground"
              >
                New &amp; featured
              </h2>
              <Link
                href="/search"
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-primary outline-none transition-colors hover:text-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                See all
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
            <FeaturedGrid items={featuredItems} />
          </section>
        ) : null}
      </HomeSections>
    </StorefrontShell>
  );
}

/**
 * The featured strip. Kept as a plain non-paginated grid (the home teaser
 * never loads more) so it can stay a server component inside the ISR shell.
 */
function FeaturedGrid({ items }: { items: ProductCardItem[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
      {items.map((item) => (
        <li key={item.product.id}>
          <FeaturedCard item={item} />
        </li>
      ))}
    </ul>
  );
}

function FeaturedCard({ item }: { item: ProductCardItem }) {
  const { product } = item;
  const primary =
    product.images.find((img) => img.isPrimary) ?? product.images[0] ?? null;
  return (
    <Link
      href={`/p/${product.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm outline-none transition-shadow focus-visible:ring-3 focus-visible:ring-ring/50 hover:shadow-md active:scale-[0.99]"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {primary ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={primary.thumbUrl ?? primary.url}
            alt={product.name}
            loading="lazy"
            // Shared-element seam into the detail gallery's hero (see grid card).
            className={`${GALLERY_HERO_CLASS} h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-105`}
            style={{ viewTransitionName: galleryTransitionName(product.id) }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <LayoutGrid className="size-7" aria-hidden />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        {product.brand ? (
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
