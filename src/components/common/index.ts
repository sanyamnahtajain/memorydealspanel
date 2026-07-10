/**
 * Common component inventory (IMPLEMENTATION_PLAN §4).
 * Import via `@/components/common`.
 */
export { PageHeader } from "./PageHeader";
export { StatCard } from "./StatCard";
export { StatusChip, type StatusChipVariant } from "./StatusChip";
export { PricePill, formatPaise } from "./PricePill";
export { EmptyState, type EmptyStateIllustration } from "./EmptyState";
export {
  Pager,
  LoadMoreButton,
  type PagerProps,
  type LoadMoreButtonProps,
} from "./Pager";
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

/* Reusable UI primitives surfaced from `@/components/ui/*`. */
export { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
export type { TooltipProps, TooltipSide } from "@/components/ui/tooltip";
export { Spinner, PageLoader } from "@/components/ui/spinner";
export type { SpinnerSize } from "@/components/ui/spinner";
export { PromptDialog, usePromptDialog } from "@/components/ui/prompt-dialog";
export type {
  PromptDialogProps,
  PromptKind,
  PromptSelectOption,
  PromptOptions,
  UsePromptDialogReturn,
} from "@/components/ui/prompt-dialog";
