import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { PageHeader } from "@/components/common/PageHeader";
import { Shimmer } from "@/components/common/Skeletons";
import { LoadingWatchdog } from "@/components/common/LoadingWatchdog";

/**
 * Orders route-level loading skeleton — header + a stack of order-card
 * placeholders (status chip, order id, date, total slot), matching the
 * history list layout so the swap is seamless.
 */
export default function OrdersLoading() {
  return (
    <StorefrontShell>
      <LoadingWatchdog />
      <div className="mx-auto w-full max-w-3xl py-6 sm:py-8" aria-busy>
        <PageHeader title="Your orders" backHref="/account" backLabel="Account" />
        <ul className="mt-6 space-y-3" aria-hidden>
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i}>
              <div className="flex items-center gap-4 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5">
                <Shimmer className="size-11 shrink-0 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <Shimmer className="h-4 w-32 rounded-full" />
                    <Shimmer className="h-5 w-16 rounded-full" />
                  </div>
                  <Shimmer className="h-3 w-28 rounded-full" />
                </div>
                <Shimmer className="h-4 w-16 rounded-full" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </StorefrontShell>
  );
}
