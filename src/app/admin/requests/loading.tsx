import { AdminShell } from "@/components/shell/AdminShell";
import { Shimmer, SkeletonCard } from "@/components/common";

/**
 * Fallback for the admin access-requests queue: header + a stack of skeleton
 * request cards (mirrors the swipe deck / list of pending requests).
 */
export default function AdminRequestsLoading() {
  return (
    <AdminShell title="Requests">
      <div className="space-y-6" aria-busy>
        <span className="sr-only" role="status">
          Loading requests…
        </span>

        <div className="space-y-2">
          <Shimmer className="h-7 w-48" />
          <Shimmer className="h-4 w-72" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
