import { AdminShell } from "@/components/shell/AdminShell";
import { Shimmer } from "@/components/common";

/** Route fallback for /admin/settings/billing-groups — intro card + group cards. */
export default function BillingGroupsLoading() {
  return (
    <AdminShell title="Billing groups">
      <div className="space-y-6" aria-busy>
        <span className="sr-only" role="status">
          Loading…
        </span>
        <div className="space-y-2">
          <Shimmer className="h-7 w-44" />
          <Shimmer className="h-4 w-80 max-w-full" />
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <Shimmer className="h-4 w-full" />
          <Shimmer className="mt-2 h-4 w-3/4" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-3">
                <Shimmer className="size-3 rounded-full" />
                <Shimmer className="h-4 w-40" />
                <Shimmer className="h-5 w-12 rounded-full" />
                <Shimmer className="ml-auto h-5 w-9 rounded-full" />
              </div>
              <div className="mt-3 flex gap-1.5">
                <Shimmer className="h-5 w-20 rounded-full" />
                <Shimmer className="h-5 w-24 rounded-full" />
                <Shimmer className="h-5 w-16 rounded-full" />
              </div>
              <Shimmer className="mt-3 h-3 w-56" />
            </div>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
