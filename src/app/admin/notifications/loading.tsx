import { AdminShell } from "@/components/shell/AdminShell";
import { Shimmer } from "@/components/common";

/** Route fallback for /admin/notifications — composer form + phone preview. */
export default function SendNotificationLoading() {
  return (
    <AdminShell title="Send a message">
      <div className="space-y-6" aria-busy>
        <span className="sr-only" role="status">
          Loading…
        </span>
        <div className="space-y-2">
          <Shimmer className="h-7 w-44" />
          <Shimmer className="h-4 w-80 max-w-full" />
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <div className="space-y-6">
            <div className="rounded-xl border border-border bg-card p-5">
              <Shimmer className="h-4 w-32" />
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Shimmer className="h-14 rounded-lg" />
                <Shimmer className="h-14 rounded-lg" />
              </div>
              <Shimmer className="mt-4 h-9 w-full rounded-lg" />
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <Shimmer className="h-4 w-36" />
              <Shimmer className="mt-4 h-8 w-full rounded-lg" />
              <Shimmer className="mt-4 h-24 w-full rounded-lg" />
              <Shimmer className="mt-4 h-8 w-full rounded-lg" />
            </div>
          </div>
          <div className="space-y-4">
            <Shimmer className="h-36 rounded-2xl" />
            <Shimmer className="h-8 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
