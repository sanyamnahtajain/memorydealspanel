import { AdminShell } from "@/components/shell/AdminShell";
import { Shimmer, SkeletonRow } from "@/components/common";

/**
 * Admin segment fallback (App Router `loading.tsx`).
 *
 * Rendered inside the {@link AdminShell} so the sidebar / top bar chrome stays
 * put and only the content area shows a neutral, route-agnostic skeleton. More
 * specific admin routes (products / dashboard / …) ship their own tailored
 * fallbacks that override this one.
 */
export default function AdminLoading() {
  return (
    <AdminShell title="Loading…">
      <div className="space-y-6" aria-busy>
        <span className="sr-only" role="status">
          Loading…
        </span>
        <div className="space-y-2">
          <Shimmer className="h-7 w-40" />
          <Shimmer className="h-4 w-64" />
        </div>
        <div className="overflow-hidden rounded-xl border border-border">
          {Array.from({ length: 8 }, (_, i) => (
            <SkeletonRow key={i} columns={4} />
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
