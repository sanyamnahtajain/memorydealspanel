import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { Shimmer, SkeletonProductCard } from "@/components/common";

/**
 * Fallback for a storefront category page: breadcrumb + title, then a grid of
 * skeleton product cards.
 */
export default function CategoryLoading() {
  return (
    <StorefrontShell>
      <div className="space-y-6" aria-busy>
        <span className="sr-only" role="status">
          Loading category…
        </span>

        {/* Breadcrumb + heading */}
        <div className="mt-2 space-y-3">
          <Shimmer className="h-4 w-40" />
          <Shimmer className="h-8 w-56" />
          <Shimmer className="h-4 w-72" />
        </div>

        {/* Product grid */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 9 }, (_, i) => (
            <SkeletonProductCard key={i} />
          ))}
        </div>
      </div>
    </StorefrontShell>
  );
}
