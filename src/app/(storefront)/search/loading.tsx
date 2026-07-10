import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { Shimmer, SkeletonProductCard } from "@/components/common";

/**
 * Fallback for the storefront search page: title, a search field placeholder,
 * then a grid of skeleton product cards for results.
 */
export default function SearchLoading() {
  return (
    <StorefrontShell>
      <div className="space-y-6" aria-busy>
        <span className="sr-only" role="status">
          Loading search…
        </span>

        {/* Heading + search box */}
        <div className="mt-2 space-y-3">
          <Shimmer className="h-8 w-64" />
          <Shimmer className="h-11 w-full rounded-full" />
        </div>

        {/* Results grid */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <SkeletonProductCard key={i} />
          ))}
        </div>
      </div>
    </StorefrontShell>
  );
}
