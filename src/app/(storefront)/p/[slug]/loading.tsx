import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { Shimmer } from "@/components/common";

/**
 * Fallback for a storefront product detail page: breadcrumb, a two-column
 * gallery + info layout, then a spec-table placeholder.
 */
export default function ProductLoading() {
  return (
    <StorefrontShell>
      <div className="space-y-8" aria-busy>
        <span className="sr-only" role="status">
          Loading product…
        </span>

        {/* Breadcrumb */}
        <Shimmer className="mt-2 h-4 w-56" />

        {/* Gallery + details */}
        <div className="grid gap-8 md:grid-cols-2">
          {/* Gallery */}
          <div className="space-y-3">
            <Shimmer className="aspect-square w-full rounded-2xl" />
            <div className="flex gap-3">
              {Array.from({ length: 4 }, (_, i) => (
                <Shimmer key={i} className="size-16 rounded-lg" />
              ))}
            </div>
          </div>

          {/* Info */}
          <div className="space-y-4">
            <Shimmer className="h-5 w-24 rounded-full" />
            <Shimmer className="h-8 w-4/5" />
            <Shimmer className="h-4 w-1/3" />
            <Shimmer className="h-10 w-40 rounded-full" />
            <div className="space-y-2 pt-2">
              <Shimmer className="h-4 w-full" />
              <Shimmer className="h-4 w-full" />
              <Shimmer className="h-4 w-2/3" />
            </div>
            <Shimmer className="h-11 w-full rounded-full sm:w-48" />
          </div>
        </div>

        {/* Spec table */}
        <div className="space-y-3">
          <Shimmer className="h-6 w-40" />
          <div className="overflow-hidden rounded-xl border border-border">
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0"
              >
                <Shimmer className="h-3.5 w-32" />
                <Shimmer className="h-3.5 w-40" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </StorefrontShell>
  );
}
