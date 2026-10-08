import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { Shimmer } from "@/components/common/Skeletons";
import { LoadingWatchdog } from "@/components/common/LoadingWatchdog";
import {
  SkeletonFilterBar,
  SkeletonProductGrid,
  SkeletonSectionHeader,
} from "../_skeletons/parts";

/**
 * Fallback for the storefront search page: title, the search launcher pill,
 * then the filter bar and a grid of product tiles for results.
 */
export default function SearchLoading() {
  return (
    <StorefrontShell>
      <div className="space-y-6" aria-busy>
        <LoadingWatchdog label="Loading search…" />

        {/* Heading + launcher pill */}
        <div className="mt-2 space-y-4">
          <Shimmer className="h-8 w-40 rounded-lg md:h-9" />
          <div className="flex min-h-13 items-center gap-3 rounded-full bg-card py-1.5 pr-4 pl-1.5 shadow-sm ring-1 ring-foreground/8">
            <Shimmer className="size-10 shrink-0 rounded-full" />
            <Shimmer className="h-3.5 w-48 rounded-full" />
          </div>
        </div>

        <SkeletonFilterBar />

        <section>
          <SkeletonSectionHeader seeAll={false} />
          <SkeletonProductGrid count={8} />
        </section>
      </div>
    </StorefrontShell>
  );
}
