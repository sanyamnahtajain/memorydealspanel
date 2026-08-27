import { AdminShell } from "@/components/shell/AdminShell";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Order detail skeleton.
 *
 * This route is force-dynamic, so opening an order from the queue is a full
 * server round-trip. WITHOUT this file Next has no fallback to show and the
 * browser keeps rendering the QUEUE until that round-trip finishes — the tap
 * looks ignored, which is exactly the "takes too long to open" complaint.
 * With it the shell paints instantly and the panel fills in.
 */
export default function Loading() {
  return (
    <AdminShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-border bg-card p-4">
              <Skeleton className="mb-4 h-5 w-24" />
              <div className="flex flex-col gap-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="size-14 shrink-0 rounded-lg" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <Skeleton className="h-4 w-3/5" />
                      <Skeleton className="h-3 w-2/5" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-border bg-card p-4">
              <Skeleton className="mb-3 h-5 w-28" />
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-3/5" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
