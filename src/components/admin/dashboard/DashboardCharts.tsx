import * as React from "react";
import {
  BarChart,
  ChartCard,
  DonutChart,
  LineChart,
  type BarDatum,
  type ChartSeries,
  type DonutSlice,
} from "@/components/charts";
import { Stagger } from "@/components/motion/primitives";
import type {
  DashboardCharts as DashboardChartsData,
  DualTimeBucket,
  NamedCount,
  StatusSlice,
  TimeBucket,
} from "@/server/services/dashboard-metrics";

/** Map a CustomerStatus to a stable chart tone. */
const CUSTOMER_STATUS_TONE: Record<string, DonutSlice["tone"]> = {
  APPROVED: "success",
  PENDING: "warning",
  REJECTED: "destructive",
  EXPIRED: "muted",
  BLOCKED: "primary",
};

const STATUS_LABEL: Record<string, string> = {
  APPROVED: "Approved",
  PENDING: "Pending",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  BLOCKED: "Blocked",
};

function hasCounts(buckets: { count: number }[]): boolean {
  return buckets.some((b) => b.count > 0);
}

/**
 * Charts section of the admin dashboard. Pure presentational server component:
 * it receives fully-resolved, serialisable datasets and lays them out in a
 * responsive grid of {@link ChartCard}s with a staggered entrance. Each card
 * self-handles its empty state.
 */
export function DashboardCharts({ data }: { data: DashboardChartsData }) {
  const requestSeries: ChartSeries[] = [
    {
      name: "Access requests",
      tone: "primary",
      points: data.accessRequests.map(toPoint),
    },
  ];

  const decisionSeries: ChartSeries[] = [
    {
      name: "Approved",
      tone: "success",
      points: data.decisions.map((b: DualTimeBucket) => ({
        label: b.label,
        value: b.count,
      })),
    },
    {
      name: "Rejected",
      tone: "destructive",
      points: data.decisions.map((b: DualTimeBucket) => ({
        label: b.label,
        value: b.countB,
      })),
    },
  ];

  const customerSlices: DonutSlice[] = data.customers
    .filter((s: StatusSlice) => s.count > 0)
    .map((s: StatusSlice) => ({
      label: STATUS_LABEL[s.status] ?? s.status,
      value: s.count,
      tone: CUSTOMER_STATUS_TONE[s.status],
    }));

  const viewedBars: BarDatum[] = data.mostViewed.map((p: NamedCount) => ({
    label: p.name,
    value: p.count,
    hint: p.hint,
    tone: "primary",
  }));

  const catalogSeries: ChartSeries[] = [
    {
      name: "Products added",
      tone: "success",
      points: data.catalog.map(toPoint),
    },
  ];

  const expiringBars: BarDatum[] = [
    { label: "Next 7 days", value: data.expiring.next7, tone: "warning" },
    { label: "8–30 days", value: data.expiring.next30, tone: "primary" },
  ];
  const hasExpiring = data.expiring.next7 + data.expiring.next30 > 0;

  return (
    <section aria-labelledby="dashboard-charts-heading" className="space-y-4">
      <h2 id="dashboard-charts-heading" className="sr-only">
        Insights
      </h2>

      <Stagger
        className="grid grid-cols-1 gap-4 lg:grid-cols-2"
        itemClassName="min-w-0"
      >
        <ChartCard
          title="Access requests"
          subtitle="New requests per day, last 30 days"
          empty={!hasCounts(data.accessRequests)}
          emptyTitle="No requests yet"
          emptyDescription="Daily access-request volume will chart here."
        >
          <LineChart
            series={requestSeries}
            area
            ariaLabel="New access requests per day over the last 30 days"
          />
        </ChartCard>

        <ChartCard
          title="Approvals vs rejections"
          subtitle="Decided requests per day, last 30 days"
          empty={!data.decisions.some((b) => b.count > 0 || b.countB > 0)}
          emptyTitle="No decisions yet"
          emptyDescription="Approved and rejected requests will chart here."
          aside={<DecisionLegend />}
        >
          <LineChart
            series={decisionSeries}
            ariaLabel="Approved versus rejected access requests per day over the last 30 days"
          />
        </ChartCard>

        <ChartCard
          title="Customers by status"
          subtitle="Distribution across the customer lifecycle"
          empty={customerSlices.length === 0}
          emptyTitle="No customers yet"
          emptyDescription="Customer status distribution will chart here."
        >
          <DonutChart
            data={customerSlices}
            ariaLabel="Customer count by status"
            centerCaption="customers"
          />
        </ChartCard>

        <ChartCard
          title="Most viewed products"
          subtitle="Top 8 by storefront views, last 30 days"
          empty={viewedBars.length === 0}
          emptyTitle="No views yet"
          emptyDescription="Product views from the storefront will rank here."
        >
          <BarChart
            data={viewedBars}
            orientation="horizontal"
            ariaLabel="Most viewed products by view count over the last 30 days"
          />
        </ChartCard>

        <ChartCard
          title="Catalog growth"
          subtitle="Products added per day, last 30 days"
          empty={!hasCounts(data.catalog)}
          emptyTitle="No new products"
          emptyDescription="Products added over time will chart here."
        >
          <LineChart
            series={catalogSeries}
            area
            ariaLabel="Products added per day over the last 30 days"
          />
        </ChartCard>

        <ChartCard
          title="Access expiring soon"
          subtitle="Live grants by time to expiry"
          empty={!hasExpiring}
          emptyTitle="Nothing expiring"
          emptyDescription="Grants nearing expiry will chart here."
        >
          <BarChart
            data={expiringBars}
            orientation="vertical"
            ariaLabel="Live access grants expiring within 7 days and within 30 days"
          />
        </ChartCard>
      </Stagger>
    </section>
  );
}

function toPoint(b: TimeBucket) {
  return { label: b.label, value: b.count };
}

/** Inline legend for the two-series decisions line chart. */
function DecisionLegend() {
  return (
    <ul className="flex items-center gap-3 text-xs text-muted-foreground">
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="size-2.5 rounded-full"
          style={{ background: "var(--success)" }}
        />
        Approved
      </li>
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="size-2.5 rounded-full"
          style={{ background: "var(--destructive)" }}
        />
        Rejected
      </li>
    </ul>
  );
}
