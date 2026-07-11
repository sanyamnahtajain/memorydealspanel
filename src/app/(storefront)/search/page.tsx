import type { Metadata } from "next";

import { PAGE_SIZES } from "@/lib/constants";
import { listActive } from "@/server/dal/categories";
import { getViewer } from "@/server/auth/viewer";
import { canSeePrices } from "@/server/types/viewer";
import { discoverProducts } from "@/server/storefront/discovery";
import { wishlistStateForViewer } from "@/server/services/wishlist";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { FadeUp } from "@/components/motion/primitives";
import { EmptyState } from "@/components/common/EmptyState";
import {
  StorefrontListing,
  buildListingItems,
  type ListingItem,
} from "@/components/storefront/listing";
import { SearchLauncher } from "@/components/storefront/SearchLauncher";
import { DiscoveryFilters } from "@/components/storefront/filters";
import {
  loadFacetData,
  selectionToDiscoverParams,
  toDiscoverSort,
} from "@/components/storefront/filters/adapter";
import { parseSelection } from "@/components/storefront/filters/types";

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
 * DISCOVERY (7.7): the query (`q`) is combined with the URL facet selection
 * (brand / spec / stock / tag, and — approved only — a price band). Facets are
 * scoped to the search result set and the first faceted page is loaded
 * server-side via `discoverProducts`, then handed to the client
 * {@link DiscoveryFilters} + {@link StorefrontListing}.
 *
 * PRICE GATE: the price-band facet is a real control only for approved viewers;
 * for everyone else it is the "log in to filter by price" chip, and the band is
 * dropped server-side so no price ever reaches a gated payload.
 */
export const dynamic = "force-dynamic";

interface SearchPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Rebuild URLSearchParams from Next's parsed searchParams object. */
function toSearchParams(
  raw: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v);
    } else if (typeof value === "string") {
      params.append(key, value);
    }
  }
  return params;
}

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const raw = await searchParams;
  const rawQuery = firstValue(raw.q).trim();

  const [categories, viewer] = await Promise.all([listActive(), getViewer()]);
  const categoryChips = categories.map((c) => ({ name: c.name, slug: c.slug }));

  // Wishlist state for the current customer: seeds the header badge count and
  // each product heart's filled state. Empty for anon/admin. Carries no price.
  const wishlistState = await wishlistStateForViewer(viewer);

  const approved = canSeePrices(viewer);
  const urlParams = toSearchParams(raw);
  const selection = parseSelection(urlParams, approved);
  const sort = toDiscoverSort(urlParams.get("sort"));
  const search = rawQuery.length > 0 ? rawQuery : undefined;

  // Facets scoped to the search result set + the first faceted page, both
  // viewer-gated. Skip the work entirely when there is no query.
  const [facets, firstPage] = search
    ? await Promise.all([
        loadFacetData(viewer, { search }),
        discoverProducts(
          viewer,
          selectionToDiscoverParams(selection, {
            approved,
            search,
            sort,
            limit: PAGE_SIZES.storefront,
          }),
        ),
      ])
    : [null, null];

  const items: ListingItem[] = firstPage
    ? buildListingItems(firstPage.items, viewer)
    : [];

  // Load-more re-runs the SAME faceted query for the next offset window; the
  // selection + query are captured server-side (gated viewers can't inject a
  // price band). Price slots stay server-rendered.
  const selectionSnapshot = selection;
  const sortSnapshot = sort;
  const searchSnapshot = search;
  async function loadMore(nextPage: number): Promise<ListingItem[]> {
    "use server";
    const page = Math.max(1, Math.trunc(nextPage));
    const v = await getViewer();
    const result = await discoverProducts(
      v,
      selectionToDiscoverParams(selectionSnapshot, {
        approved: canSeePrices(v),
        search: searchSnapshot,
        sort: sortSnapshot,
        limit: page * PAGE_SIZES.storefront,
      }),
    );
    const start = (page - 1) * PAGE_SIZES.storefront;
    return buildListingItems(result.items.slice(start), v);
  }

  return (
    <StorefrontShell wishlistCount={wishlistState.count}>
      <FadeUp>
        <div className="mt-2 mb-5">
          <h1 className="mb-3 font-heading text-2xl font-bold tracking-tight text-foreground md:text-3xl">
            Search
          </h1>
          <SearchLauncher
            query={rawQuery}
            categories={categoryChips}
            autoOpen={rawQuery.length === 0}
          />
        </div>
      </FadeUp>

      {rawQuery.length === 0 || !facets || !firstPage ? (
        <EmptyState
          illustration="no-results"
          title="Search the catalogue"
          description="Start typing a product name or brand to find what you need."
        />
      ) : (
        <div>
          <p className="mb-4 text-sm text-muted-foreground">
            Showing results for{" "}
            <span className="font-medium text-foreground">“{rawQuery}”</span>
          </p>
          <DiscoveryFilters facets={facets} resultCount={firstPage.total}>
            <StorefrontListing
              initialItems={items}
              loadMore={loadMore}
              pageSize={PAGE_SIZES.storefront}
              initialPage={1}
              canSeePrices={approved}
              total={firstPage.total}
              emptyTitle={`No results for “${rawQuery}”`}
              emptyDescription="Try a different keyword, or browse by category."
              savedProductIds={wishlistState.savedProductIds}
            />
          </DiscoveryFilters>
        </div>
      )}
    </StorefrontShell>
  );
}
