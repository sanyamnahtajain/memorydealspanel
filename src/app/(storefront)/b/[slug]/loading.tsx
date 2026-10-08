import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { LoadingWatchdog } from "@/components/common/LoadingWatchdog";
import {
  SkeletonFilterBar,
  SkeletonPageTitle,
  SkeletonProductGrid,
} from "../../_skeletons/parts";

/**
 * Fallback for a storefront brand page: back link + logo/title, the filter
 * bar, then the product grid in the listing's column counts.
 */
export default function BrandLoading() {
  return (
    <StorefrontShell>
      <div className="space-y-5" aria-busy>
        <LoadingWatchdog label="Loading brand…" />
        <SkeletonPageTitle logo subtitle={false} />
        <SkeletonFilterBar />
        <SkeletonProductGrid count={8} />
      </div>
    </StorefrontShell>
  );
}
