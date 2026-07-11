import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { Shimmer, SkeletonProductCard } from "@/components/common";

/**
 * Fallback for a storefront brand page: back link + logo/title, then a grid of
 * skeleton product cards.
 */
export default function BrandLoading() {
  return (
    <StorefrontShell>
      <div className="space-y-6" aria-busy>
        <span className="sr-only" role="status">
          Loading brand…
        </span>

        {/* Back link + heading */}
        <div className="mt-2 space-y-3">
          <Shimmer className="h-4 w-36" />
          <div className="flex items-center gap-3">
            <Shimmer className="size-11 rounded-lg" />
            <Shimmer className="h-8 w-56" />
          </div>
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
