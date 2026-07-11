import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading placeholder for the desktop filter rail, matching its width and the
 * stacked-section rhythm so there is no layout shift when facets arrive.
 */
export function FacetSkeleton() {
  return (
    <aside className="hidden w-64 shrink-0 md:block" aria-hidden>
      <div className="sticky top-20">
        <Skeleton className="mb-2 h-5 w-16" />
        <div className="space-y-4 rounded-xl border border-border bg-card p-3">
          {Array.from({ length: 4 }).map((_, section) => (
            <div key={section} className="space-y-2 border-b border-border/60 pb-4 last:border-b-0 last:pb-0">
              <Skeleton className="h-4 w-24" />
              {Array.from({ length: 4 }).map((__, row) => (
                <div key={row} className="flex items-center gap-2.5">
                  <Skeleton className="size-4 rounded" />
                  <Skeleton className="h-3.5 flex-1" />
                  <Skeleton className="h-3.5 w-6" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
