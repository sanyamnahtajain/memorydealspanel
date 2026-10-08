import { AdminShell } from "@/components/shell/AdminShell";
import { Shimmer } from "@/components/common";
import { LoadingWatchdog } from "@/components/common/LoadingWatchdog";

/**
 * Fallback for the admin reels page: header + a grid of 9:16 card
 * skeletons, the same shape the loaded list takes.
 */
export default function AdminReelsLoading() {
  return (
    <AdminShell title="Reels">
      <div className="space-y-6" aria-busy>
        <LoadingWatchdog label="Loading reels…" />

        <div className="space-y-2">
          <Shimmer className="h-7 w-28" />
          <Shimmer className="h-4 w-80 max-w-full" />
        </div>

        <div className="flex items-center justify-between">
          <Shimmer className="h-4 w-24" />
          <Shimmer className="h-8 w-28 rounded-lg" />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div
              key={i}
              className="overflow-hidden rounded-xl border border-border bg-card"
            >
              <Shimmer className="aspect-[9/16] w-full rounded-none" />
              <div className="space-y-2 p-3">
                <Shimmer className="h-4 w-11/12" />
                <Shimmer className="h-3 w-2/3" />
                <Shimmer className="h-7 w-full rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
