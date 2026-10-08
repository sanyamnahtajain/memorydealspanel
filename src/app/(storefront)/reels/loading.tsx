import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { Shimmer } from "@/components/common";
import { LoadingWatchdog } from "@/components/common/LoadingWatchdog";

/**
 * /reels fallback: the first clip's frame, dark, exactly where it will land,
 * so the feed appears without a jump. Phones get the full-height frame edge
 * to edge; desktop the stage outline.
 */
export default function ReelsLoading() {
  return (
    <StorefrontShell>
      <div aria-busy>
        <LoadingWatchdog label="Loading reels…" />

        {/* Phones — a full frame between header and tab bar. */}
        <div
          className="-mx-4 -mb-4 bg-black md:hidden"
          // Same calc as .reel-feed (reels.css), so the skeleton and the feed
          // are the same height and the swap is invisible.
          style={{
            height:
              "calc(100dvh - var(--md-header-h, 3rem) - env(safe-area-inset-top, 0px) - var(--md-tab-h, 3.5rem) - 1px - env(safe-area-inset-bottom, 0px))",
          }}
        >
          <div className="relative h-full w-full">
            <Shimmer className="absolute inset-0 rounded-none bg-neutral-900" />
            <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-4 pr-20">
              <Shimmer className="h-9 w-40 rounded-full bg-neutral-800" />
              <Shimmer className="h-4 w-4/5 rounded bg-neutral-800" />
              <Shimmer className="h-4 w-3/5 rounded bg-neutral-800" />
            </div>
          </div>
        </div>

        {/* Desktop — header + stage. */}
        <div className="hidden md:block">
          <div className="flex items-end justify-between gap-4 py-8">
            <div className="space-y-2">
              <Shimmer className="h-3 w-32" />
              <Shimmer className="h-8 w-28" />
              <Shimmer className="h-4 w-72" />
            </div>
            <Shimmer className="h-11 w-44 rounded-full" />
          </div>
          <div className="rounded-3xl bg-neutral-950 ring-1 ring-foreground/10">
            <div className="mx-auto grid max-w-5xl grid-cols-[auto_minmax(0,24rem)] items-center justify-center gap-10 px-8 py-10 lg:gap-16 lg:px-12">
              <Shimmer className="aspect-[9/16] h-[min(80vh,46rem)] rounded-3xl bg-neutral-900" />
              <div className="space-y-4">
                <Shimmer className="h-3 w-28 bg-neutral-800" />
                <Shimmer className="h-6 w-full bg-neutral-800" />
                <Shimmer className="h-6 w-3/4 bg-neutral-800" />
                <Shimmer className="mt-6 h-20 w-full rounded-2xl bg-neutral-800" />
                <div className="flex gap-2 pt-2">
                  <Shimmer className="h-11 w-44 rounded-full bg-neutral-800" />
                  <Shimmer className="h-11 w-28 rounded-full bg-neutral-800" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </StorefrontShell>
  );
}
