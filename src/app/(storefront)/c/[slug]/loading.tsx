import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { LoadingWatchdog } from "@/components/common/LoadingWatchdog";
import {
  SkeletonFilterBar,
  SkeletonPageTitle,
  SkeletonProductGrid,
} from "../../_skeletons/parts";

/**
 * Fallback for a storefront category page: back link + title + subtitle, the
 * filter/sort bar, then the product grid in the listing's column counts.
 */
export default function CategoryLoading() {
  return (
    <StorefrontShell>
      <div className="space-y-5" aria-busy>
        <LoadingWatchdog label="Loading category…" />
        <SkeletonPageTitle />
        <SkeletonFilterBar />
        <SkeletonProductGrid count={8} />
      </div>
    </StorefrontShell>
  );
}
