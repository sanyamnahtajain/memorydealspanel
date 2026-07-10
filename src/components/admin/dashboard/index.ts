/**
 * Admin dashboard presentational pieces. Import via
 * `@/components/admin/dashboard`.
 */
export { StatGrid, type StatItem } from "./StatGrid";
export { ActivityFeed, humanizeAudit, type ActivityItem } from "./ActivityFeed";
export { MiniList, type MiniListItem } from "./MiniList";
export { DashboardPanel } from "./DashboardPanel";
export { DashboardCharts } from "./DashboardCharts";
export {
  StatGridSkeleton,
  PanelSkeleton,
  DashboardChartsSkeleton,
} from "./DashboardSkeletons";
export { QuickActionCard, type QuickActionCardProps } from "./QuickActionCard";
export { ExpiringList, type ExpiringGrantItem } from "./ExpiringList";
