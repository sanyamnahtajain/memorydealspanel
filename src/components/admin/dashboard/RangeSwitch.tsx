import Link from "next/link";

import { cn } from "@/lib/utils";

export const DASHBOARD_RANGES = [7, 30, 90] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export function parseDashboardRange(raw: string | string[] | undefined): DashboardRange {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return (DASHBOARD_RANGES as readonly number[]).includes(n) ? (n as DashboardRange) : 30;
}

/**
 * The window every "last N days" insight uses. Plain links (no client JS):
 * the page re-renders with the new range in the URL, so it is shareable and
 * survives a refresh. Server component.
 */
export function RangeSwitch({ value }: { value: DashboardRange }) {
  return (
    <div
      role="group"
      aria-label="Insights window"
      className="inline-flex h-9 items-center rounded-lg border border-border bg-card p-0.5 text-xs font-medium"
    >
      {DASHBOARD_RANGES.map((days) => {
        const active = days === value;
        return (
          <Link
            key={days}
            href={days === 30 ? "/admin/dashboard" : `/admin/dashboard?range=${days}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-full min-w-11 items-center justify-center rounded-md px-2.5 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {days}d
          </Link>
        );
      })}
    </div>
  );
}
