import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { PAGE_SIZES } from "@/lib/constants";
import { getBySlug } from "@/server/dal/categories";
import { getViewer } from "@/server/auth/viewer";
import { canSeePrices } from "@/server/types/viewer";
import {
  brandFacetsForCategory,
  discoverProducts,
} from "@/server/storefront/discovery";
import { stockFacet } from "@/server/dal/facets";
import { wishlistStateForViewer } from "@/server/services/wishlist";
import { cartCountForViewer } from "@/server/services/cart";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { FadeUp } from "@/components/motion/primitives";
import {
  ListingFilters,
  StorefrontListing,
  buildListingItems,
  type ListingItem,
  type LoadMoreResult,
} from "@/components/storefront/listing";
import { isObjectId } from "@/components/storefront/listing/filter-params";
import {
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
 * DISCOVERY (7.7): the URL search params carry the active facet selection.
 * The page parses that selection, loads the CONTEXT-SCOPED facets (only the
 * brands with visible products in THIS category, with counts, plus stock) and
 * the first faceted PAGE server-side via `discoverProducts`, and hands both to
 * {@link StorefrontListing} with a {@link ListingFilters} chip bar. Legacy
 * spec/tag/band params from older shared links are still honoured server-side.
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
  const rawSelection = parseSelection(urlParams, approved);
  // A malformed brand id in a hand-edited link must narrow to nothing —
  // never reach a Prisma ObjectId filter and throw.
  const selection = {
    ...rawSelection,
    brands: rawSelection.brands.filter(isObjectId),
  };
  const sort = toDiscoverSort(urlParams.get("sort"));
  const categoryId = category.id;

  // ONE parallel round: context facets + first page (viewer-gated) alongside
  // the viewer-scoped chrome reads (wishlist, cart badge). These used to run
  // as sequential awaits — on a remote database that is round-trips of pure
  // added latency on every category view.
  const [brandFacets, stockCounts, firstPage, wishlistState, cartCount] =
    await Promise.all([
      // CONTEXT SCOPE: only brands with visible products in THIS category.
      brandFacetsForCategory(categoryId),
      stockFacet({ categoryId }),
      discoverProducts(
        viewer,
        selectionToDiscoverParams(selection, {
          approved,
          categoryId,
          sort,
          limit: PAGE_SIZES.storefront,
        }),
      ),
      // Wishlist state: header badge + heart fills. Empty for anon/admin.
      wishlistStateForViewer(viewer),
      // Header cart badge — a count only for an approved customer.
      cartCountForViewer(viewer),
    ]);

  const items: ListingItem[] = buildListingItems(firstPage.items, viewer);

  // Load-more fetches exactly ONE page after the given cursor (the previous
  // page's `nextCursor` — an opaque product id, no price). The selection is
  // captured server-side so gated viewers can never inject a price band via
  // the client. Price slots stay server-rendered, and the total is never
  // re-counted (the first page already carried it).
  const selectionSnapshot = selection;
  const sortSnapshot = sort;
  async function loadMore(cursor: string): Promise<LoadMoreResult> {
    "use server";
    // The cursor is client-supplied: a malformed id must end the list, never
    // reach Prisma's ObjectId cursor and throw.
    if (!isObjectId(cursor)) return { items: [], nextCursor: null };
    const v = await getViewer();
    const result = await discoverProducts(v, {
      ...selectionToDiscoverParams(selectionSnapshot, {
        approved: canSeePrices(v),
        categoryId,
        sort: sortSnapshot,
        cursor,
        limit: PAGE_SIZES.storefront,
      }),
      // The first page already reported the total; appended pages never
      // re-count (finding 6).
      withTotal: false,
    });
    return {
      items: buildListingItems(result.items, v),
      nextCursor: result.nextCursor,
    };
  }

  return (
    <StorefrontShell wishlistCount={wishlistState.count} cartCount={cartCount}>
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

      {/* CONTEXT-SCOPED FILTERS: brand chips limited to brands that actually
          have visible products in THIS category (never the whole brand list),
          plus stock — in a chip bar + bottom sheet. */}
      <StorefrontListing
        initialItems={items}
        loadMore={loadMore}
        initialNextCursor={firstPage.nextCursor}
        canSeePrices={approved}
        total={firstPage.total}
        emptyTitle="Nothing in this category yet"
        emptyDescription="We're adding stock here soon — check back shortly."
        savedProductIds={wishlistState.savedProductIds}
        filterSlot={
          <ListingFilters
            contextFacet={{
              param: "brand",
              title: "Brand",
              buckets: brandFacets.map((b) => ({
                value: b.id,
                label: b.name,
                count: b.count,
              })),
            }}
            stockCounts={stockCounts}
          />
        }
      />
    </StorefrontShell>
  );
}
