import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { PageHeader } from "@/components/common/PageHeader";
import { Shimmer } from "@/components/common/Skeletons";

/**
 * Cart route-level loading skeleton. Mirrors the two-column layout (line list +
 * summary sidebar) so the transition is seamless while the server resolves the
 * gated cart.
 */
export default function CartLoading() {
  return (
    <StorefrontShell>
      <div className="mx-auto w-full max-w-5xl py-6 pb-28 sm:py-8 lg:pb-8">
        <PageHeader title="Your cart" backHref="/account" backLabel="Account" />
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
          <ul className="flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <li
                key={i}
                className="flex gap-3 rounded-xl border border-border bg-card p-3"
              >
                <Shimmer className="size-20 shrink-0 rounded-lg" />
                <div className="flex-1 space-y-2 py-1">
                  <Shimmer className="h-3 w-24 rounded" />
                  <Shimmer className="h-4 w-3/4 rounded" />
                  <Shimmer className="h-3 w-16 rounded" />
                  <div className="flex items-center justify-between pt-2">
                    <Shimmer className="h-8 w-24 rounded-lg" />
                    <Shimmer className="h-5 w-16 rounded" />
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden lg:block">
            <div className="space-y-3 rounded-xl border border-border bg-card p-4">
              <Shimmer className="h-4 w-28 rounded" />
              <Shimmer className="h-3 w-full rounded" />
              <Shimmer className="h-3 w-full rounded" />
              <Shimmer className="h-20 w-full rounded-lg" />
              <Shimmer className="h-9 w-full rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    </StorefrontShell>
  );
}
