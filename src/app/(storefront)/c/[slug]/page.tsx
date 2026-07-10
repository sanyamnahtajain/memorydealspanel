import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { PAGE_SIZES } from "@/lib/constants";
import { getBySlug } from "@/server/dal/categories";
import { listByCategoryForViewer } from "@/server/dal/products";
import { getViewer } from "@/server/auth/viewer";
import { canSeePrices } from "@/server/types/viewer";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { FadeUp } from "@/components/motion/primitives";
import {
  StorefrontListing,
  buildListingItems,
  type ListingItem,
} from "@/components/storefront/listing";
import { loadMoreCategoryProducts } from "./actions";

/**
 * Category listing.
 *
 * RENDERING: this route reads the current viewer (cookies) so it can unlock
 * live pricing for approved customers, which makes it dynamic. It never
 * embeds a price for a gated viewer — the DAL projects prices away and each
 * listing item renders a locked pill. (A pure-ISR variant is impossible on the
 * same route while gating per-viewer; keep it dynamic.)
 *
 * The listing surface itself (view modes, stock filter, sort, load-more) is
 * the client {@link StorefrontListing}; this page only server-loads the first
 * page (already gated) and binds a load-more server action.
 */
export const dynamic = "force-dynamic";

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const category = await getBySlug(slug);
  if (!category) {
    return { title: "Category not found — MemoryDeals" };
  }
  // NOTE: metadata is price-free by construction.
  return {
    title: `${category.name} — MemoryDeals`,
    description: `Browse ${category.name} in the MemoryDeals wholesale catalogue. Approved buyers unlock live trade pricing.`,
    openGraph: {
      title: `${category.name} — MemoryDeals`,
      type: "website",
    },
  };
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  const { slug } = await params;
  const category = await getBySlug(slug);
  if (!category) {
    notFound();
  }

  const viewer = await getViewer();
  const products = await listByCategoryForViewer(viewer, category.id, {
    page: 1,
    take: PAGE_SIZES.storefront,
  });

  const items: ListingItem[] = buildListingItems(products, viewer);

  // Bind the category id to the load-more action so the client listing only
  // needs to pass the next page number. Price slots stay server-rendered.
  const categoryId = category.id;
  async function loadMore(nextPage: number): Promise<ListingItem[]> {
    "use server";
    return loadMoreCategoryProducts(categoryId, nextPage);
  }

  return (
    <StorefrontShell>
      <FadeUp>
        <div className="mt-2 mb-4">
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded-full py-1 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronLeft className="size-4" aria-hidden />
            All categories
          </Link>
          <h1 className="mt-2 font-heading text-2xl font-bold tracking-tight text-foreground md:text-3xl">
            {category.name}
          </h1>
        </div>
      </FadeUp>

      <StorefrontListing
        initialItems={items}
        loadMore={loadMore}
        pageSize={PAGE_SIZES.storefront}
        initialPage={1}
        canSeePrices={canSeePrices(viewer)}
        emptyTitle="Nothing in this category yet"
        emptyDescription="We're adding stock here soon — check back shortly."
      />
    </StorefrontShell>
  );
}
