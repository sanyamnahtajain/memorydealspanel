import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { PAGE_SIZES } from "@/lib/constants";
import { getBrandBySlug } from "@/server/dal/brands";
import { getBySlug } from "@/server/dal/categories";
import { getViewer } from "@/server/auth/viewer";
import { canSeePrices } from "@/server/types/viewer";
import { discoverProducts } from "@/server/storefront/discovery";
import { wishlistStateForViewer } from "@/server/services/wishlist";
import { cartCountForViewer } from "@/server/services/cart";
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
 * Brand → Category → Products (with filters). Lists products that are BOTH this
 * brand AND category, filterable within that scope (spec / stock / tag, and —
 * approved only — price band). Viewer-gated; reached from the brand's category
 * grid.
 */
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string; categorySlug: string }>;
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
}: PageProps): Promise<Metadata> {
  const { slug, categorySlug } = await params;
  const [brand, category] = await Promise.all([
    getBrandBySlug(slug),
    getBySlug(categorySlug),
  ]);
  if (!brand || !category) return { title: "Not found — MemoryDeals" };
  return {
    title: `${brand.name} ${category.name} — MemoryDeals`,
    description: `Browse ${brand.name} ${category.name} in the MemoryDeals wholesale catalogue. Approved buyers unlock live trade pricing.`,
    robots: { index: false, follow: true },
  };
}

export default async function BrandCategoryPage({
  params,
  searchParams,
}: PageProps) {
  const { slug, categorySlug } = await params;
  const raw = await searchParams;
  const [brand, category] = await Promise.all([
    getBrandBySlug(slug),
    getBySlug(categorySlug),
  ]);
  if (!brand || !category) notFound();

  const viewer = await getViewer();
  const approved = canSeePrices(viewer);
  const urlParams = toSearchParams(raw);
  const selection = parseSelection(urlParams, approved);
  const sort = toDiscoverSort(urlParams.get("sort"));
  const brandIds = [brand.id];
  const categoryId = category.id;

  const [facets, firstPage, wishlistState, cartCount] = await Promise.all([
    loadFacetData(viewer, { brandIds, categoryId }),
    discoverProducts(viewer, {
      ...selectionToDiscoverParams(selection, {
        approved,
        categoryId,
        sort,
        limit: PAGE_SIZES.storefront,
      }),
      brandIds,
    }),
    wishlistStateForViewer(viewer),
    cartCountForViewer(viewer),
  ]);

  const items: ListingItem[] = buildListingItems(firstPage.items, viewer);

  const selectionSnapshot = selection;
  const sortSnapshot = sort;
  async function loadMore(nextPage: number): Promise<ListingItem[]> {
    "use server";
    const page = Math.max(1, Math.trunc(nextPage));
    const v = await getViewer();
    const result = await discoverProducts(v, {
      ...selectionToDiscoverParams(selectionSnapshot, {
        approved: canSeePrices(v),
        categoryId,
        sort: sortSnapshot,
        limit: page * PAGE_SIZES.storefront,
      }),
      brandIds,
    });
    return buildListingItems(
      result.items.slice((page - 1) * PAGE_SIZES.storefront),
      v,
    );
  }

  return (
    <StorefrontShell wishlistCount={wishlistState.count} cartCount={cartCount}>
      <FadeUp>
        <div className="mt-2 mb-5">
          <Link
            href={`/b/${slug}`}
            className="inline-flex items-center gap-1 rounded-full py-1 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {brand.name}
          </Link>

          <div className="mt-2 flex items-center gap-3">
            {brand.logo ? (
              <span className="relative size-10 shrink-0 overflow-hidden rounded-lg border border-border bg-white">
                <Image
                  src={brand.logo}
                  alt={`${brand.name} logo`}
                  fill
                  sizes="40px"
                  className="object-contain p-1"
                />
              </span>
            ) : null}
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {brand.name}
              </p>
              <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                {category.name}
              </h1>
            </div>
          </div>
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
          emptyTitle={`No ${brand.name} ${category.name} match`}
          emptyDescription="Try clearing a filter, or check back as we add stock."
          savedProductIds={wishlistState.savedProductIds}
        />
      </DiscoveryFilters>
    </StorefrontShell>
  );
}
