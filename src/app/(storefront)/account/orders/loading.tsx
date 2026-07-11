import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { PageHeader } from "@/components/common/PageHeader";
import { Shimmer } from "@/components/common/Skeletons";

/**
 * Orders route-level loading skeleton — header + a stack of order-card
 * placeholders, matching the history list layout so the swap is seamless.
 */
export default function OrdersLoading() {
  return (
    <StorefrontShell>
      <div className="mx-auto w-full max-w-3xl py-6 sm:py-8">
        <PageHeader title="Your orders" backHref="/account" backLabel="Account" />
        <ul className="mt-6 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i}>
              <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4">
                <Shimmer className="size-10 shrink-0 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Shimmer className="h-4 w-40 rounded" />
                  <Shimmer className="h-3 w-28 rounded" />
                </div>
                <Shimmer className="h-4 w-16 rounded" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </StorefrontShell>
  );
}
