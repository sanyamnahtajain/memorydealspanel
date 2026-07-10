import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { Shimmer, SkeletonProductCard } from "@/components/common";

/**
 * Storefront segment fallback (App Router `loading.tsx`).
 *
 * Rendered inside the {@link StorefrontShell} so the header / bottom tab chrome
 * stays put and only the content shows a hero + product-grid skeleton. More
 * specific storefront routes ship their own tailored fallbacks.
 */
export default function StorefrontLoading() {
  return (
    <StorefrontShell>
      <div className="space-y-8" aria-busy>
        <span className="sr-only" role="status">
          Loading…
        </span>

        {/* Hero */}
        <Shimmer className="mt-2 h-48 w-full rounded-2xl md:h-64" />

        {/* Product grid */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <SkeletonProductCard key={i} />
          ))}
        </div>
      </div>
    </StorefrontShell>
  );
}
