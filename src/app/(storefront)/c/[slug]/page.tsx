import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { PAGE_SIZES } from "@/lib/constants";
import { getBySlug } from "@/server/dal/categories";
import { getViewer } from "@/server/auth/viewer";
import { canSeePrices } from "@/server/types/viewer";
import { discoverProducts } from "@/server/storefront/discovery";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { FadeUp } from "@/components/motion/primitives";
import {
  StorefrontListing,
  buildListingItems,
  type ListingItem,
} from "@/components/storefront/listing";
import { DiscoveryFilters } from "@/components/storefront/filters";
import {
  loadFacetData,
  selectionToDiscoverParams,
  toDiscoverSort,
} from "@/components/storefront/filters/adapter";
import { parseSelection } from "@/components/storefront/filters/types";

/**
 * Category listing.
 *
 * RENDERING: this route reads the current viewer (cookies) so it can unlock
 * live pricing for approved customers, which makes it dynamic. It never
 * embeds a price for a gated viewer — the DAL projects prices away and each
 * listing item renders a locked pill.
 *
 * DISCOVERY (7.7): the URL search params carry the active facet selection
 * (brand / spec / stock / tag, plus — for approved viewers only — a price
 * band). The page parses that selection, loads the FACETS (bounded aggregate
 * counts) and the first faceted PAGE server-side via `discoverProducts`, and
 * hands both to the client {@link DiscoveryFilters} + {@link StorefrontListing}.
 *
 * PRICE GATE: `canSeePrices(viewer)` decides whether the price-band facet is a
 * real control (approved) or a "log in to filter by price" chip (everyone
 * else); the band selection is dropped server-side for gated viewers, and no
 * price ever enters a gated payload.
 */
export const dynamic = "force-dynamic";

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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

export default async function CategoryPage({
  params,
  searchParams,
}: CategoryPageProps) {
  const { slug } = await params;
  const [raw, viewer] = await Promise.all([searchParams, getViewer()]);
  const category = await getBySlug(slug);
  if (!category) {
    notFound();
  }

  const approved = canSeePrices(viewer);
  const urlParams = toSearchParams(raw);
  const selection = parseSelection(urlParams, approved);
  const sort = toDiscoverSort(urlParams.get("sort"));
  const categoryId = category.id;

  // Facets (bounded aggregations) + first faceted page, both viewer-gated.
  const [facets, firstPage] = await Promise.all([
    loadFacetData(viewer, { categoryId }),
    discoverProducts(
      viewer,
      selectionToDiscoverParams(selection, {
        approved,
        categoryId,
        sort,
        limit: PAGE_SIZES.storefront,
      }),
    ),
  ]);

  const items: ListingItem[] = buildListingItems(firstPage.items, viewer);

  // Load-more re-runs the SAME faceted query for the next offset window. The
  // selection is captured server-side so gated viewers can never inject a price
  // band via the client. Price slots stay server-rendered.
  const selectionSnapshot = selection;
  const sortSnapshot = sort;
  async function loadMore(nextPage: number): Promise<ListingItem[]> {
    "use server";
    const page = Math.max(1, Math.trunc(nextPage));
    const v = await getViewer();
    const result = await discoverProducts(
      v,
      selectionToDiscoverParams(selectionSnapshot, {
        approved: canSeePrices(v),
        categoryId,
        sort: sortSnapshot,
        limit: page * PAGE_SIZES.storefront,
      }),
    );
    // Offset paging over the bounded faceted set: return only the new window.
    const start = (page - 1) * PAGE_SIZES.storefront;
    return buildListingItems(result.items.slice(start), v);
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

      <DiscoveryFilters facets={facets} resultCount={firstPage.total}>
        <StorefrontListing
          initialItems={items}
          loadMore={loadMore}
          pageSize={PAGE_SIZES.storefront}
          initialPage={1}
          canSeePrices={approved}
          total={firstPage.total}
          emptyTitle="Nothing in this category yet"
          emptyDescription="We're adding stock here soon — check back shortly."
        />
      </DiscoveryFilters>
    </StorefrontShell>
  );
}
