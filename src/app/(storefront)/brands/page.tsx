import type { Metadata } from "next";

import { listBrandsWithCounts } from "@/server/dal/brands";
import { APP_NAME } from "@/lib/constants";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { PageHeader, EmptyState } from "@/components/common";
import { BrandDirectory } from "@/components/storefront/BrandDirectory";

export const metadata: Metadata = {
  title: "Brands",
  description: `Shop by brand at ${APP_NAME} — boAt, realme, OnePlus, Ambrane, Portronics, Noise and more mobile-accessory brands at wholesale.`,
};

// Public catalogue structure — safe to cache (carries no pricing).
export const revalidate = 300;

export default async function BrandsPage() {
  const brands = await listBrandsWithCounts();

  return (
    <StorefrontShell>
      <div className="py-6 md:py-8">
        <PageHeader
          title="Brands"
          description="Shop by your favourite brand."
        />
        <div className="mt-6">
          {brands.length > 0 ? (
            <BrandDirectory brands={brands} />
          ) : (
            <EmptyState
              illustration="empty-box"
              title="No brands yet"
              description="Check back soon — new stock is added regularly."
            />
          )}
        </div>
      </div>
    </StorefrontShell>
  );
}
