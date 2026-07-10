import { AdminShell } from "@/components/shell/AdminShell";
import { Shimmer, SkeletonRow } from "@/components/common";

/**
 * Fallback for the admin customers list: header + a bordered table of
 * skeleton rows.
 */
export default function AdminCustomersLoading() {
  return (
    <AdminShell title="Customers">
      <div className="space-y-6" aria-busy>
        <span className="sr-only" role="status">
          Loading customers…
        </span>

        <div className="space-y-2">
          <Shimmer className="h-7 w-36" />
          <Shimmer className="h-4 w-64" />
        </div>

        <div className="flex flex-wrap gap-2">
          <Shimmer className="h-9 flex-1 basis-56 rounded-lg" />
          <Shimmer className="h-9 w-32 rounded-lg" />
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
