import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PAGE_SIZES } from "@/lib/constants";
import { getBrandBySlug, listBrandCategories } from "@/server/dal/brands";
import { getViewer } from "@/server/auth/viewer";
import { canSeePrices } from "@/server/types/viewer";
import { discoverProducts } from "@/server/storefront/discovery";
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
import {
  CONTEXT_FILTER_PARAMS,
  isObjectId,
  parseListParam,
} from "@/components/storefront/listing/filter-params";
import { BrandCategoryRail } from "@/components/storefront/brand/BrandCategoryRail";
import { BrandHero } from "@/components/storefront/brand/BrandHero";
import { brandName, catalogLabel } from "@/lib/display-case";
import {
  selectionToDiscoverParams,
  toDiscoverSort,
} from "@/components/storefront/filters/adapter";
import { parseSelection } from "@/components/storefront/filters/types";

/**
 * Brand landing — brand → category → products, with CONTEXT-SCOPED filters.
 *
 * Blinkit layout: the brand's header (owner cover + tagline, or logo + name),
 * then — for a brand spanning more than one category — a sticky rail of its
 * categories on the left (owner-ordered, with per-brand photos and names; see
 * src/lib/brand-layout.ts) beside the product grid. A rail tap sets the `cat`
 * URL param on this same page. THE CORE RULE: a brand page NEVER shows a
 * brand facet (you are already inside one brand); the brand scope is fixed
 * server-side, so filters only ever narrow WITHIN the brand. Price gate intact
 * (gated viewers get locked pills).
 */
export const dynamic = "force-dynamic";

interface BrandPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function toSearchParams(
  raw: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) for (const v of value) params.append(key, v);
    else if (typeof value === "string") params.append(key, value);
  }
  return params;
}

export async function generateMetadata({
  params,
}: BrandPageProps): Promise<Metadata> {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) return { title: "Brand not found — MemoryDeals" };
  return {
    title: `${brand.name} — MemoryDeals`,
    description: `Browse ${brand.name} products by category in the MemoryDeals wholesale catalogue. Approved buyers unlock live trade pricing.`,
    openGraph: { title: `${brand.name} — MemoryDeals`, type: "website" },
  };
}

export default async function BrandPage({
  params,
  searchParams,
}: BrandPageProps) {
  const { slug } = await params;
  const raw = await searchParams;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();

  const viewer = await getViewer();
  const approved = canSeePrices(viewer);
  const urlParams = toSearchParams(raw);
  const selection = parseSelection(urlParams, approved);
  const sort = toDiscoverSort(urlParams.get("sort"));
  const brandIds = [brand.id];
  // Category chips selection (`cat` param) — malformed ids narrow to nothing,
  // never reach a Prisma ObjectId filter.
  const categoryIds = parseListParam(
    urlParams,
    CONTEXT_FILTER_PARAMS.category,
  ).filter(isObjectId);

  const [categories, stockCounts, firstPage, wishlistState, cartCount] =
    await Promise.all([
      // The rail: this brand's categories in the OWNER's order, with the
      // owner's per-brand photos and names (cached catalogue read + layout).
      listBrandCategories(brand.id, brand.layout),
      stockFacet({ brandIds }),
      discoverProducts(viewer, {
        ...selectionToDiscoverParams(selection, {
          approved,
          sort,
          limit: PAGE_SIZES.storefront,
        }),
        // The brand scope is FIXED server-side; the URL can never widen it
        // (selection.brands is overridden here, so a brand facet is moot).
        brandIds,
        categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
      }),
      wishlistStateForViewer(viewer),
      cartCountForViewer(viewer),
    ]);

  const items: ListingItem[] = buildListingItems(firstPage.items, viewer);

  // Load-more fetches exactly ONE page after the given cursor (an opaque
  // product id, no price); the total is never re-counted (finding 6).
  const selectionSnapshot = selection;
  const sortSnapshot = sort;
  const categoryIdsSnapshot = categoryIds;
  async function loadMore(cursor: string): Promise<LoadMoreResult> {
    "use server";
    // Client-supplied cursor: a malformed id ends the list, never throws.
    if (!isObjectId(cursor)) return { items: [], nextCursor: null };
    const v = await getViewer();
    const result = await discoverProducts(v, {
      ...selectionToDiscoverParams(selectionSnapshot, {
        approved: canSeePrices(v),
        sort: sortSnapshot,
        cursor,
        limit: PAGE_SIZES.storefront,
      }),
      brandIds,
      categoryIds:
        categoryIdsSnapshot.length > 0 ? categoryIdsSnapshot : undefined,
      withTotal: false,
    });
    return {
      items: buildListingItems(result.items, v),
      nextCursor: result.nextCursor,
    };
  }

  // The rail selection: one category (the `cat` param from a rail tap) or
  // "All". A multi-select from an old link simply shows "All" highlighted.
  const activeCategory =
    categoryIds.length === 1 ? (categories.find((c) => c.id === categoryIds[0]) ?? null) : null;
  const showRail = categories.length > 1;
  const displayName = brandName(brand.name);
  const listingTitle = activeCategory ? catalogLabel(activeCategory.name) : `All ${displayName}`;
  const productCount = categories.reduce((sum, c) => sum + c.count, 0);

  const listing = (
    <StorefrontListing
      initialItems={items}
      loadMore={loadMore}
      initialNextCursor={firstPage.nextCursor}
      canSeePrices={approved}
      total={firstPage.total}
      emptyTitle={`No ${brand.name} products match`}
      emptyDescription="Try clearing a filter, or check back as we add stock."
      savedProductIds={wishlistState.savedProductIds}
      // The rail IS the category filter here, so the chip bar keeps only
      // stock (never a brand facet — you are already inside one brand).
      filterSlot={<ListingFilters contextFacet={null} stockCounts={stockCounts} />}
      toolbarBleed={!showRail}
    />
  );

  return (
    <StorefrontShell wishlistCount={wishlistState.count} cartCount={cartCount}>
      <FadeUp>
        <BrandHero
          name={displayName}
          productCount={productCount}
          logo={brand.logo}
          coverImage={brand.coverImage}
          tagline={brand.tagline}
        />
      </FadeUp>

      {showRail ? (
        // BLINKIT LAYOUT: the brand's categories down a narrow sticky rail on
        // the left, the products beside it. One page; a rail tap swaps `cat`.
        <div className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-2 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-6">
          <BrandCategoryRail
            brandSlug={slug}
            categories={categories}
            activeId={activeCategory?.id ?? null}
            totalLabel={`All ${displayName}`}
          />
          <section aria-labelledby="brand-listing" className="min-w-0">
            <h2
              id="brand-listing"
              // "All" repeats the header right above it — keep it for screen
              // readers only; a picked category gets a visible title.
              className={
                activeCategory
                  ? "mb-2 font-heading text-base font-bold tracking-tight text-foreground md:text-xl"
                  : "sr-only"
              }
            >
              {listingTitle}
            </h2>
            {listing}
          </section>
        </div>
      ) : (
        <section aria-labelledby="brand-listing">
          <h2 id="brand-listing" className="mb-3 font-heading text-lg font-bold tracking-tight text-foreground md:text-xl">
            All {displayName} products
          </h2>
          {listing}
        </section>
      )}
    </StorefrontShell>
  );
}
