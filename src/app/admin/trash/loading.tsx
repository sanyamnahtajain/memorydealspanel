import { AdminShell } from "@/components/shell/AdminShell";
import { Shimmer, SkeletonRow } from "@/components/common";

/**
 * Fallback for the admin trash view: header + a bordered table of skeleton
 * rows for soft-deleted records.
 */
export default function AdminTrashLoading() {
  return (
    <AdminShell title="Trash">
      <div className="space-y-6" aria-busy>
        <span className="sr-only" role="status">
          Loading trash…
        </span>

        <div className="space-y-2">
          <Shimmer className="h-7 w-28" />
          <Shimmer className="h-4 w-64" />
        </div>

        <div className="overflow-hidden rounded-xl border border-border">
          {Array.from({ length: 6 }, (_, i) => (
            <SkeletonRow key={i} columns={4} />
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
