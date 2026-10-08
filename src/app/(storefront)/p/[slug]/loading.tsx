import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { Shimmer } from "@/components/common/Skeletons";
import { LoadingWatchdog } from "@/components/common/LoadingWatchdog";
import { SkeletonProductRail, SkeletonSectionHeader } from "../../_skeletons/parts";

/**
 * Fallback for a storefront product detail page — the real page's boxes:
 * breadcrumb, a sticky square gallery with thumbnails, the title block, the
 * rounded price panel with its pills and CTA, trust row, collapsible specs,
 * and the related rail.
 */
export default function ProductLoading() {
  return (
    <StorefrontShell>
      <div className="mx-auto w-full max-w-5xl py-3 sm:py-8" aria-busy>
        <LoadingWatchdog label="Loading product…" />

        {/* Breadcrumb */}
        <div className="flex items-center gap-2" aria-hidden>
          <Shimmer className="h-3.5 w-12 rounded-full" />
          <Shimmer className="size-1.5 rounded-full" />
          <Shimmer className="h-3.5 w-24 rounded-full" />
          <Shimmer className="size-1.5 rounded-full" />
          <Shimmer className="h-3.5 w-32 rounded-full" />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] md:gap-10 lg:gap-12">
          {/* Gallery */}
          <div className="md:sticky md:top-20 md:self-start" aria-hidden>
            <div className="relative aspect-square w-full overflow-hidden rounded-3xl bg-muted/60 p-8 ring-1 ring-foreground/5">
              <Shimmer className="size-full rounded-2xl" />
              <Shimmer className="absolute top-3 right-3 size-10 rounded-full bg-background/80" />
            </div>
            <div className="mt-3 flex gap-2.5">
              {Array.from({ length: 4 }, (_, i) => (
                <Shimmer key={i} className="size-16 rounded-xl" />
              ))}
            </div>
          </div>

          {/* Title block + price panel */}
          <div className="flex flex-col gap-5 sm:gap-6" aria-hidden>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Shimmer className="h-6 w-20 rounded-full" />
                <Shimmer className="h-3 w-16 rounded-full" />
              </div>
              <Shimmer className="h-7 w-11/12 rounded-lg sm:h-8 lg:h-9" />
              <Shimmer className="h-7 w-2/3 rounded-lg sm:h-8 lg:h-9" />
              <div className="flex items-center gap-2.5 pt-1">
                <Shimmer className="h-6 w-24 rounded-full" />
                <Shimmer className="h-3 w-28 rounded-full" />
              </div>
            </div>

            <div className="rounded-3xl bg-card p-4 shadow-sm ring-1 ring-foreground/5 sm:p-6">
              <div className="flex items-end justify-between gap-4">
                <div className="space-y-2">
                  <Shimmer className="h-2.5 w-16 rounded-full" />
                  <Shimmer className="h-9 w-36 rounded-lg" />
                </div>
                <Shimmer className="h-8 w-24 rounded-full" />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Shimmer className="h-8 w-28 rounded-full" />
                <Shimmer className="h-8 w-32 rounded-full" />
              </div>
              <div className="mt-4 flex flex-col gap-3">
                <Shimmer className="h-12 w-full rounded-full" />
                <Shimmer className="hidden h-11 w-full rounded-full md:block" />
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2">
                <Shimmer className="h-12 rounded-xl" />
                <Shimmer className="h-12 rounded-xl" />
                <Shimmer className="h-12 rounded-xl" />
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/5 sm:p-5">
              <Shimmer className="size-6 shrink-0 rounded-md" />
              <div className="flex-1 space-y-2">
                <Shimmer className="h-3.5 w-40 rounded-full" />
                <Shimmer className="h-3 w-full rounded-full" />
                <Shimmer className="h-3 w-3/4 rounded-full" />
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl ring-1 ring-foreground/5">
              <div className="flex items-center justify-between px-4 py-3.5">
                <Shimmer className="h-4 w-32 rounded-full" />
                <Shimmer className="size-5 rounded-full" />
              </div>
              {Array.from({ length: 4 }, (_, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-4 border-t border-foreground/5 px-4 py-3"
                >
                  <Shimmer className="h-3 w-28 rounded-full" />
                  <Shimmer className="h-3 w-36 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Related rail */}
        <section className="mt-12">
          <SkeletonSectionHeader seeAll={false} />
          <SkeletonProductRail />
        </section>
      </div>
    </StorefrontShell>
  );
}
