import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { PageHeader } from "@/components/common/PageHeader";
import { Shimmer } from "@/components/common/Skeletons";
import { LoadingWatchdog } from "@/components/common/LoadingWatchdog";

/**
 * Cart route-level loading skeleton. Mirrors the two-column layout (line list +
 * summary sidebar) so the transition is seamless while the server resolves the
 * gated cart. Line thumbnails use the padded `object-contain` surface the real
 * cart rows draw.
 */
export default function CartLoading() {
  return (
    <StorefrontShell>
      <LoadingWatchdog />
      <div className="mx-auto w-full max-w-5xl py-6 pb-28 sm:py-8 lg:pb-8" aria-busy>
        <PageHeader title="Your cart" backHref="/account" backLabel="Account" />
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <ul className="flex flex-col gap-3" aria-hidden>
            {Array.from({ length: 3 }).map((_, i) => (
              <li
                key={i}
                className="flex gap-3 rounded-2xl bg-card p-3 shadow-sm ring-1 ring-foreground/5"
              >
                <div className="size-20 shrink-0 rounded-xl bg-muted/60 p-2">
                  <Shimmer className="size-full rounded-lg" />
                </div>
                <div className="flex-1 space-y-2 py-1">
                  <Shimmer className="h-2.5 w-20 rounded-full" />
                  <Shimmer className="h-4 w-3/4 rounded-full" />
                  <Shimmer className="h-3 w-16 rounded-full" />
                  <div className="flex items-center justify-between pt-2">
                    <Shimmer className="h-9 w-28 rounded-full" />
                    <Shimmer className="h-5 w-16 rounded-full" />
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden lg:block" aria-hidden>
            <div className="space-y-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5">
              <Shimmer className="h-4 w-28 rounded-full" />
              <Shimmer className="h-3 w-full rounded-full" />
              <Shimmer className="h-3 w-full rounded-full" />
              <Shimmer className="h-20 w-full rounded-xl" />
              <Shimmer className="h-11 w-full rounded-full" />
            </div>
          </div>
        </div>
      </div>
    </StorefrontShell>
  );
}
