import type { Metadata } from "next";

import { PAGE_SIZES } from "@/lib/constants";
import { listActive } from "@/server/dal/categories";
import { getViewer } from "@/server/auth/viewer";
import { canSeePrices } from "@/server/types/viewer";
import { searchCatalog } from "@/server/storefront/catalog";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { FadeUp } from "@/components/motion/primitives";
import { EmptyState } from "@/components/common/EmptyState";
import {
  StorefrontListing,
  buildListingItems,
  type ListingItem,
} from "@/components/storefront/listing";
import { SearchLauncher } from "@/components/storefront/SearchLauncher";
import { loadMoreSearchProducts } from "./actions";

export const metadata: Metadata = {
  title: "Search — MemoryDeals",
  description: "Search the MemoryDeals wholesale catalogue by product or brand.",
  robots: { index: false, follow: false },
};

/**
 * Search results. Reads the current viewer to unlock live pricing for
 * approved customers, so it is dynamic. Gated viewers only ever receive
 * PublicProduct projections; each listing item renders a locked pill.
 *
 * The results surface (view modes, stock filter, sort, load-more) is the
 * client {@link StorefrontListing}; this page server-loads the first gated
 * page and binds a load-more server action.
 */
export const dynamic = "force-dynamic";

interface SearchPageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q } = await searchParams;
  const rawQuery = (q ?? "").trim();

  const [categories, viewer] = await Promise.all([listActive(), getViewer()]);
  const categoryChips = categories.map((c) => ({ name: c.name, slug: c.slug }));

  const {
    items: products,
    query,
    total,
  } = rawQuery
    ? await searchCatalog(rawQuery)
    : { items: [], query: "", total: 0 };

  const items: ListingItem[] = buildListingItems(products, viewer);

  // Bind the query to the load-more action; the client listing passes only the
  // next page number. Price slots stay server-rendered.
  const boundQuery = query;
  async function loadMore(nextPage: number): Promise<ListingItem[]> {
    "use server";
    return loadMoreSearchProducts(boundQuery, nextPage);
  }

  return (
    <StorefrontShell>
      <FadeUp>
        <div className="mt-2 mb-5">
          <h1 className="mb-3 font-heading text-2xl font-bold tracking-tight text-foreground md:text-3xl">
            Search
          </h1>
          <SearchLauncher
            query={query}
            categories={categoryChips}
            autoOpen={rawQuery.length === 0}
          />
        </div>
      </FadeUp>

      {rawQuery.length === 0 ? (
        <EmptyState
          illustration="no-results"
          title="Search the catalogue"
          description="Start typing a product name or brand to find what you need."
        />
      ) : (
        <div>
          <p className="mb-4 text-sm text-muted-foreground">
            Showing results for{" "}
            <span className="font-medium text-foreground">“{query}”</span>
          </p>
          <StorefrontListing
            initialItems={items}
            loadMore={loadMore}
            pageSize={PAGE_SIZES.storefront}
            initialPage={1}
            canSeePrices={canSeePrices(viewer)}
            total={total}
            emptyTitle={`No results for “${query}”`}
            emptyDescription="Try a different keyword, or browse by category."
          />
        </div>
      )}
    </StorefrontShell>
  );
}
