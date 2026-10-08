import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { LoadingWatchdog } from "@/components/common/LoadingWatchdog";
import {
  SkeletonBanner,
  SkeletonBrandRow,
  SkeletonCategoryGrid,
  SkeletonProductRail,
  SkeletonSectionHeader,
} from "./_skeletons/parts";

/**
 * Storefront segment fallback (App Router `loading.tsx`).
 *
 * Rendered inside the {@link StorefrontShell} so the header / bottom tab chrome
 * stays put and only the content shimmers. Mirrors the home page's rhythm —
 * banner strip, category teaser (8 tiles on phones, 12 from md), brand row,
 * best-seller rail — with the same header boxes (subtitle lines reserved
 * where the real header has one), so the real page develops in place
 * without a height jump. More specific routes ship their own fallbacks.
 */
export default function StorefrontLoading() {
  return (
    <StorefrontShell>
      <div className="space-y-10 md:space-y-16" aria-busy>
        <LoadingWatchdog label="Loading…" />

        <SkeletonBanner className="mt-3" />

        <section>
          <SkeletonSectionHeader subtitle />
          <SkeletonCategoryGrid teaser />
        </section>

        <section>
          <SkeletonSectionHeader />
          <SkeletonBrandRow />
        </section>

        <section>
          <SkeletonSectionHeader seeAll={false} subtitle />
          <SkeletonProductRail />
        </section>
      </div>
    </StorefrontShell>
  );
}
