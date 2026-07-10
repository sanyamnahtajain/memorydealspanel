import type { Metadata } from "next";

import { PAGE_SIZES } from "@/lib/constants";
import { listActive } from "@/server/dal/categories";
import { getViewer } from "@/server/auth/viewer";
import { searchCatalog } from "@/server/storefront/catalog";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { FadeUp } from "@/components/motion/primitives";
import { EmptyState } from "@/components/common/EmptyState";
import {
  ProductCardGrid,
  type ProductCardItem,
} from "@/components/storefront/ProductCardGrid";
import { SearchLauncher } from "@/components/storefront/SearchLauncher";
import { renderPriceSlot } from "@/components/storefront/priceSlot";
import { loadMoreSearchProducts } from "./actions";

export const metadata: Metadata = {
  title: "Search — MemoryDeals",
  description: "Search the MemoryDeals wholesale catalogue by product or brand.",
  robots: { index: false, follow: false },
};

/**
 * Search results. Reads the current viewer to unlock live pricing for
 * approved customers, so it is dynamic. Gated viewers only ever receive
 * PublicProduct projections; the price slot renders a locked pill.
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

  const items: ProductCardItem[] = products.map((product) => ({
    product,
    priceSlot: renderPriceSlot(product, viewer),
  }));

  // Bind the query to the load-more action; the client grid passes only the
  // next page number. Price slots stay server-rendered.
  const boundQuery = query;
  async function loadMore(nextPage: number): Promise<ProductCardItem[]> {
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
            {total.toLocaleString("en-IN")}{" "}
            {total === 1 ? "result" : "results"} for{" "}
            <span className="font-medium text-foreground">“{query}”</span>
          </p>
          <ProductCardGrid
            initialItems={items}
            loadMore={loadMore}
            pageSize={PAGE_SIZES.storefront}
            initialPage={1}
            emptyTitle={`No results for “${query}”`}
            emptyDescription="Try a different keyword, or browse by category."
          />
        </div>
      )}
    </StorefrontShell>
  );
}
