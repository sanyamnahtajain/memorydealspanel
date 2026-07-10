import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { PAGE_SIZES } from "@/lib/constants";
import { getBySlug } from "@/server/dal/categories";
import { listByCategoryForViewer } from "@/server/dal/products";
import { getViewer } from "@/server/auth/viewer";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { FadeUp } from "@/components/motion/primitives";
import {
  ProductCardGrid,
  type ProductCardItem,
} from "@/components/storefront/ProductCardGrid";
import { CategoryFilters } from "@/components/storefront/CategoryFilters";
import { renderPriceSlot } from "@/components/storefront/priceSlot";

/**
 * Category listing.
 *
 * RENDERING: this route reads the current viewer (cookies) so it can unlock
 * live pricing for approved customers, which makes it dynamic. It never
 * embeds a price for a gated viewer — the DAL projects prices away and the
 * price slot renders a locked pill. (A pure-ISR variant is impossible on the
 * same route while gating per-viewer; keep it dynamic.)
 */
export const dynamic = "force-dynamic";

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ brand?: string }>;
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

function parseBrands(raw: string | undefined): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((b) => b.trim())
        .filter(Boolean),
    ),
  );
}

export default async function CategoryPage({
  params,
  searchParams,
}: CategoryPageProps) {
  const [{ slug }, { brand }] = await Promise.all([params, searchParams]);
  const category = await getBySlug(slug);
  if (!category) {
    notFound();
  }

  const viewer = await getViewer();
  const products = await listByCategoryForViewer(viewer, category.id, {
    take: PAGE_SIZES.max,
  });

  const brands = Array.from(
    new Set(products.map((p) => p.brand).filter((b): b is string => Boolean(b))),
  ).sort((a, b) => a.localeCompare(b));

  // Only honour brand params that actually exist in this category.
  const selectedBrands = parseBrands(brand).filter((b) => brands.includes(b));

  const items: ProductCardItem[] = products.map((product) => ({
    product,
    priceSlot: renderPriceSlot(product, viewer),
  }));

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
          <p className="mt-1 text-sm text-muted-foreground">
            {products.length} {products.length === 1 ? "product" : "products"}
          </p>
        </div>
      </FadeUp>

      {brands.length > 0 ? (
        <div className="sticky top-14 z-30 -mx-4 mb-4 border-b border-transparent bg-background/80 px-4 py-2 backdrop-blur md:top-16">
          <CategoryFilters brands={brands} selected={selectedBrands} />
        </div>
      ) : null}

      <ProductCardGrid
        initialItems={items}
        pageSize={PAGE_SIZES.max}
        filterBrands={selectedBrands}
        emptyTitle="Nothing in this category yet"
        emptyDescription="We're adding stock here soon — check back shortly."
      />
    </StorefrontShell>
  );
}
