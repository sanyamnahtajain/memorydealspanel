import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { PageHeader } from "@/components/common/PageHeader";
import { LoadingWatchdog } from "@/components/common/LoadingWatchdog";
import { SkeletonProductTile } from "../../_skeletons/parts";

/**
 * Wishlist route-level loading skeleton. Mirrors the page layout — header +
 * a responsive grid of product tiles — so the transition is seamless while
 * the server resolves the (gated) saved products.
 */
export default function WishlistLoading() {
  return (
    <StorefrontShell>
      <LoadingWatchdog />
      <div className="mx-auto w-full max-w-5xl py-6 sm:py-8" aria-busy>
        <PageHeader
          title="Your wishlist"
          backHref="/account"
          backLabel="Account"
        />
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i}>
              <SkeletonProductTile />
            </li>
          ))}
        </ul>
      </div>
    </StorefrontShell>
  );
}
