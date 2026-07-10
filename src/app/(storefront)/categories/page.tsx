import type { Metadata } from "next";

import { listActive } from "@/server/dal/categories";
import { APP_NAME } from "@/lib/constants";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { PageHeader, EmptyState } from "@/components/common";
import { CategoryGrid } from "@/components/storefront/CategoryGrid";

export const metadata: Metadata = {
  title: "Categories",
  description: `Browse all mobile-accessory categories at ${APP_NAME} — chargers, cables, power banks, earphones and more.`,
};

// Public catalog structure — safe to cache (carries no pricing).
export const revalidate = 300;

export default async function CategoriesPage() {
  const categories = await listActive();

  return (
    <StorefrontShell>
      <div className="py-6 md:py-8">
        <PageHeader
          title="Categories"
          description="Browse the full range by category."
        />
        <div className="mt-6">
          {categories.length > 0 ? (
            <CategoryGrid categories={categories} animated />
          ) : (
            <EmptyState
              illustration="empty-box"
              title="No categories yet"
              description="Check back soon — new stock is added regularly."
            />
          )}
        </div>
      </div>
    </StorefrontShell>
  );
}
