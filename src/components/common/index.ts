/**
 * Common component inventory (IMPLEMENTATION_PLAN §4).
 * Import via `@/components/common`.
 */
export { PageHeader } from "./PageHeader";
export { StatCard } from "./StatCard";
export { StatusChip, type StatusChipVariant } from "./StatusChip";
export { PricePill, formatPaise } from "./PricePill";
export { EmptyState, type EmptyStateIllustration } from "./EmptyState";
export { ConfirmSheet } from "./ConfirmSheet";
export { useIsMobile, MOBILE_BREAKPOINT } from "./use-is-mobile";
export {
  Shimmer,
  SkeletonCard,
  SkeletonRow,
  SkeletonStat,
  SkeletonProductCard,
} from "./Skeletons";
export { AppToaster } from "./Toaster";
