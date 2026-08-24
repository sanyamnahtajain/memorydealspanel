import { AdminShell } from "@/components/shell/AdminShell";
import { Shimmer } from "@/components/common";

/** Route fallback for /admin/settings/notifications — device card + switches. */
export default function NotificationSettingsLoading() {
  return (
    <AdminShell title="Notifications">
      <div className="space-y-6" aria-busy>
        <span className="sr-only" role="status">
          Loading…
        </span>
        <div className="space-y-2">
          <Shimmer className="h-7 w-40" />
          <Shimmer className="h-4 w-80 max-w-full" />
        </div>
        <div className="max-w-2xl space-y-6">
          {/* This device */}
          <div className="rounded-xl border border-border bg-card p-5">
            <Shimmer className="h-4 w-28" />
            <Shimmer className="mt-2 h-4 w-full" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Shimmer className="h-14 rounded-lg" />
              <Shimmer className="h-14 rounded-lg" />
            </div>
            <Shimmer className="mt-4 h-8 w-40 rounded-lg" />
          </div>
          {/* Which messages */}
          <div className="rounded-xl border border-border bg-card p-5">
            <Shimmer className="h-4 w-44" />
            <div className="mt-4 space-y-4">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex items-start justify-between gap-4">
                  <div className="w-full space-y-2">
                    <Shimmer className="h-4 w-36" />
                    <Shimmer className="h-3 w-60 max-w-full" />
                  </div>
                  <Shimmer className="h-5 w-9 shrink-0 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
