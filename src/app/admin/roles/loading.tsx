import { AdminShell } from "@/components/shell/AdminShell";
import { Shimmer } from "@/components/common";

/**
 * Fallback for the admin roles list: header + a responsive grid of skeleton
 * role cards mirroring the real layout.
 */
export default function AdminRolesLoading() {
  return (
    <AdminShell title="Roles">
      <div className="space-y-6" aria-busy>
        <span className="sr-only" role="status">
          Loading roles…
        </span>

        <div className="space-y-2">
          <Shimmer className="h-7 w-28" />
          <Shimmer className="h-4 w-80 max-w-full" />
        </div>

        <div className="flex items-center justify-between gap-3">
          <Shimmer className="h-4 w-16" />
          <Shimmer className="h-8 w-28 rounded-lg" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-start gap-2.5">
                <Shimmer className="size-9 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Shimmer className="h-4 w-32" />
                  <Shimmer className="h-3 w-full" />
                </div>
              </div>
              <div className="mt-4 flex gap-4">
                <Shimmer className="h-4 w-24" />
                <Shimmer className="h-4 w-16" />
              </div>
              <div className="mt-4 flex justify-end gap-2 border-t border-border/70 pt-3">
                <Shimmer className="h-7 w-16 rounded-lg" />
                <Shimmer className="h-7 w-16 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
