import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { PageHeader } from "@/components/common/PageHeader";
import { SkeletonProductCard } from "@/components/common/Skeletons";

/**
 * Wishlist route-level loading skeleton. Mirrors the page layout — header +
 * a responsive grid of product-card placeholders — so the transition is
 * seamless while the server resolves the (gated) saved products.
 */
export default function WishlistLoading() {
  return (
    <StorefrontShell>
      <div className="mx-auto w-full max-w-5xl py-6 sm:py-8">
        <PageHeader
          title="Your wishlist"
          backHref="/account"
          backLabel="Account"
        />
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i}>
              <SkeletonProductCard className="[&_[data-slot=shimmer]]:aspect-[4/3]" />
            </li>
          ))}
        </ul>
      </div>
    </StorefrontShell>
  );
}
