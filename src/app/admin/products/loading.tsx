import { AdminShell } from "@/components/shell/AdminShell";
import { Shimmer, SkeletonRow } from "@/components/common";

/**
 * Fallback for the admin products list. Mirrors the real page: header with
 * title + actions, a filter bar, then a bordered table of skeleton rows.
 */
export default function AdminProductsLoading() {
  return (
    <AdminShell title="Products">
      <div className="space-y-6" aria-busy>
        <span className="sr-only" role="status">
          Loading products…
        </span>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Shimmer className="h-7 w-32" />
            <Shimmer className="h-4 w-56" />
          </div>
          <div className="flex gap-2">
            <Shimmer className="h-9 w-28 rounded-lg" />
            <Shimmer className="h-9 w-32 rounded-lg" />
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-2">
          <Shimmer className="h-9 flex-1 basis-56 rounded-lg" />
          <Shimmer className="h-9 w-36 rounded-lg" />
          <Shimmer className="h-9 w-32 rounded-lg" />
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-border">
          {Array.from({ length: 9 }, (_, i) => (
            <SkeletonRow key={i} columns={4} />
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
