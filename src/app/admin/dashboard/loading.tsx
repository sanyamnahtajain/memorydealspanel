import { AdminShell } from "@/components/shell/AdminShell";
import { Shimmer, SkeletonStat, SkeletonRow } from "@/components/common";

/**
 * Fallback for the admin dashboard: header, a row of skeleton stat cards
 * (matching {@link StatCard}), then a couple of panel placeholders.
 */
export default function AdminDashboardLoading() {
  return (
    <AdminShell title="Dashboard">
      <div className="space-y-6" aria-busy>
        <span className="sr-only" role="status">
          Loading dashboard…
        </span>

        <div className="space-y-2">
          <Shimmer className="h-7 w-40" />
          <Shimmer className="h-4 w-72" />
        </div>

        {/* Stat cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonStat key={i} />
          ))}
        </div>

        {/* Panels */}
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-card p-4 shadow-sm"
            >
              <Shimmer className="h-5 w-40" />
              <div className="mt-4">
                {Array.from({ length: 4 }, (_, j) => (
                  <SkeletonRow key={j} columns={3} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
