import * as React from "react";
import {
  BadgeIndianRupee,
  Boxes,
  PackageCheck,
  Receipt,
  ShoppingBag,
  Timer,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";

import {
  BarChart,
  ChartCard,
  DonutChart,
  type BarDatum,
  type DonutSlice,
} from "@/components/charts";
import type { DashboardInsights as InsightsData, MoneyShare } from "@/server/services/dashboard-insights";
import { StatGrid, type StatItem } from "./StatGrid";
import { DashboardPanel } from "./DashboardPanel";
import { MiniList, type MiniListItem } from "./MiniList";
import { FunnelSteps } from "./FunnelSteps";
import { fmtHours, fmtInt, fmtMoney, pct, pctDelta } from "./insights-format";

/**
 * The business insights section of the admin dashboard: trade KPIs with a
 * comparison to the previous window, who buys, what sells by category and
 * brand, when retailers order, the view-to-order funnel, stock health and
 * the access funnel. Pure presentational server component over the
 * serialisable {@link InsightsData}; every card owns its empty state.
 *
 * Phone first: KPI grids are two-up, every chart stacks to one column, and
 * the hour-of-day chart draws an axis label on every sixth hour so 24 bars
 * stay legible on a 360px screen (tooltips and the data table name them all).
 */
export function DashboardInsights({ data }: { data: InsightsData }) {
  const { trade, days } = data;
  const window = `last ${days} days`;
  const prevLabel = `vs prior ${days}d`;

  const kpis: StatItem[] = [
    {
      key: "value",
      label: "Order value",
      value: fmtMoney(trade.current.valuePaise, true),
      icon: <BadgeIndianRupee aria-hidden />,
      delta: pctDelta(trade.current.valuePaise, trade.previous.valuePaise),
      deltaLabel: prevLabel,
    },
    {
      key: "orders",
      label: "Orders",
      value: fmtInt(trade.current.orders),
      icon: <ShoppingBag aria-hidden />,
      delta: pctDelta(trade.current.orders, trade.previous.orders),
      deltaLabel: prevLabel,
    },
    {
      key: "aov",
      label: "Avg order",
      value: fmtMoney(trade.current.avgOrderPaise, true),
      icon: <Receipt aria-hidden />,
      delta: pctDelta(trade.current.avgOrderPaise, trade.previous.avgOrderPaise),
      deltaLabel: prevLabel,
    },
    {
      key: "buyers",
      label: "Buyers",
      value: fmtInt(trade.current.buyers),
      icon: <Users aria-hidden />,
      delta: pctDelta(trade.current.buyers, trade.previous.buyers),
      deltaLabel: `${fmtInt(trade.newBuyers)} new · ${fmtInt(trade.returningBuyers)} returning`,
    },
    {
      key: "fulfilment",
      label: "Time to fulfil",
      value: fmtHours(trade.avgFulfilmentHours),
      icon: <Timer aria-hidden />,
      deltaLabel: `${fmtInt(trade.current.fulfilled)} fulfilled`,
    },
    {
      key: "cancelled",
      label: "Cancelled",
      value: `${pct(trade.current.cancelled, trade.current.orders + trade.current.cancelled)}%`,
      icon: <XCircle aria-hidden />,
      deltaLabel: `${fmtInt(trade.current.cancelled)} of ${fmtInt(trade.current.orders + trade.current.cancelled)}`,
    },
  ];

  const categoryBars = moneyBars(data.byCategory);
  const brandBars = moneyBars(data.byBrand);

  const hourBars: BarDatum[] = data.rhythm.byHour.map((count, h) => ({
    label: hourLabel(h),
    value: count,
    hint: `${hourLabel(h)}–${hourLabel((h + 1) % 24)}`,
    tone: "primary",
  }));
  const weekdayBars: BarDatum[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => ({
    label: d,
    value: data.rhythm.byWeekday[i] ?? 0,
    tone: "primary",
  }));
  const hasOrders = trade.current.orders > 0;

  const stockSlices: DonutSlice[] = (
    [
      { label: "In stock", value: data.stock.inStock, tone: "success" },
      { label: "Low", value: data.stock.low, tone: "warning" },
      { label: "Out of stock", value: data.stock.outOfStock, tone: "destructive" },
    ] satisfies DonutSlice[]
  ).filter((s) => s.value > 0);

  const atRisk: MiniListItem[] = data.stock.atRisk.map((p) => ({
    id: p.id,
    title: p.name,
    subtitle: `${p.sku} · ${p.stockStatus === "LOW" ? "low stock" : "out of stock"}`,
    metric: fmtInt(p.units),
    metricLabel: "pcs ordered",
    href: `/admin/products/${p.id}`,
  }));

  const customers: MiniListItem[] = data.topCustomers.map((c) => ({
    id: c.id,
    title: c.name,
    subtitle: [c.hint, `${fmtInt(c.count)} ${c.count === 1 ? "order" : "orders"}`].filter(Boolean).join(" · "),
    metric: fmtMoney(c.valuePaise, true),
    href: `/admin/customers/${c.id}`,
  }));

  const viewedNotOrdered: MiniListItem[] = data.viewedNotOrdered.map((p) => ({
    id: p.id,
    title: p.name,
    subtitle: p.sku,
    metric: fmtInt(p.views),
    metricLabel: "views, 0 orders",
    href: `/admin/products/${p.id}`,
  }));

  const cityBars: BarDatum[] = data.byCity.map((c) => ({ label: c.city, value: c.count, tone: "primary" }));

  const accessKpis: StatItem[] = [
    { key: "requested", label: "Requested", value: fmtInt(data.access.requested), icon: <UserPlus aria-hidden /> },
    {
      key: "approved",
      label: "Approved",
      value: fmtInt(data.access.approved),
      icon: <PackageCheck aria-hidden />,
      deltaLabel: `${pct(data.access.approved, data.access.approved + data.access.rejected)}% of decided`,
    },
    { key: "pending", label: "Waiting", value: fmtInt(data.access.pending), icon: <Boxes aria-hidden /> },
    { key: "decision", label: "Time to decide", value: fmtHours(data.access.avgDecisionHours), icon: <Timer aria-hidden /> },
  ];

  return (
    <div className="space-y-8">
      <InsightSection id="insights-trade" title="Trade" subtitle={`Non-cancelled orders, ${window}, compared with the ${days} days before.`}>
        <StatGrid items={kpis} columns={3} dense />
      </InsightSection>

      <InsightSection id="insights-sales" title="What sells" subtitle={`Ordered value by category and brand, ${window}.`}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard
            title="Sales by category"
            subtitle="₹ ordered per category"
            empty={categoryBars.length === 0}
            emptyTitle="No category sales yet"
            emptyDescription="Ordered value will break down by category here."
          >
            <BarChart data={categoryBars} orientation="horizontal" ariaLabel={`Ordered value by category, ${window}`} />
          </ChartCard>
          <ChartCard
            title="Sales by brand"
            subtitle="₹ ordered per brand"
            empty={brandBars.length === 0}
            emptyTitle="No brand sales yet"
            emptyDescription="Ordered value will break down by brand here."
          >
            <BarChart data={brandBars} orientation="horizontal" ariaLabel={`Ordered value by brand, ${window}`} />
          </ChartCard>
        </div>
      </InsightSection>

      <InsightSection id="insights-customers" title="Who buys" subtitle={`Top customers by ordered value, ${window}, and where approved retailers are.`}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <DashboardPanel title="Top customers" description="By ordered value" action={{ label: "All customers", href: "/admin/customers" }}>
            <MiniList items={customers} emptyTitle="No orders yet" emptyDescription="Customers will rank here by what they ordered." />
          </DashboardPanel>
          <ChartCard
            title="Retailers by city"
            subtitle="Approved customers"
            empty={cityBars.length === 0}
            emptyTitle="No cities yet"
            emptyDescription="Approved retailers will be counted by city here."
          >
            <BarChart data={cityBars} orientation="horizontal" ariaLabel="Approved customers by city" />
          </ChartCard>
        </div>
      </InsightSection>

      <InsightSection id="insights-rhythm" title="When retailers order" subtitle={`Orders by hour of day and by weekday (IST), ${window}.`}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="By hour" subtitle="Orders placed per hour of the day" empty={!hasOrders} emptyTitle="No orders yet" emptyDescription="The hour-of-day pattern will chart here.">
            <BarChart data={hourBars} orientation="vertical" height={180} labelEvery={6} ariaLabel={`Orders by hour of day, ${window}`} />
          </ChartCard>
          <ChartCard title="By weekday" subtitle="Orders placed per weekday" empty={!hasOrders} emptyTitle="No orders yet" emptyDescription="The weekday pattern will chart here.">
            <BarChart data={weekdayBars} orientation="vertical" height={180} ariaLabel={`Orders by weekday, ${window}`} />
          </ChartCard>
        </div>
      </InsightSection>

      <InsightSection id="insights-demand" title="Demand" subtitle={`From product views to fulfilled orders, ${window}.`}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <DashboardPanel title="View → order funnel" description="Each step as a share of the one before">
            <FunnelSteps
              steps={[
                { label: "Product views", value: data.funnel.views },
                { label: "Added to cart", value: data.funnel.cartAdds },
                { label: "Orders placed", value: data.funnel.orders },
                { label: "Fulfilled", value: data.funnel.fulfilled },
              ]}
            />
          </DashboardPanel>
          <DashboardPanel title="Viewed, never ordered" description="Popular on the storefront, no orders in the window — a price or stock question" action={{ label: "All products", href: "/admin/products" }}>
            <MiniList items={viewedNotOrdered} emptyTitle="Nothing stuck" emptyDescription="Every well-viewed product has been ordered." />
          </DashboardPanel>
        </div>
      </InsightSection>

      <InsightSection id="insights-stock" title="Stock health" subtitle="Active products by stock status, and demand sitting on thin stock.">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="Stock status" subtitle="Active products" empty={stockSlices.length === 0} emptyTitle="No products" emptyDescription="Stock status will chart here.">
            <DonutChart data={stockSlices} ariaLabel="Active products by stock status" centerCaption="products" />
          </ChartCard>
          <DashboardPanel title="Demand at risk" description={`Ordered in the ${window}, now low or out of stock`} action={{ label: "All products", href: "/admin/products" }}>
            <MiniList items={atRisk} emptyTitle="Nothing at risk" emptyDescription="Everything that sold recently is in stock." />
          </DashboardPanel>
        </div>
      </InsightSection>

      <InsightSection id="insights-access" title="Access funnel" subtitle={`Requests received and decided, ${window}.`}>
        <StatGrid items={accessKpis} columns={4} dense />
      </InsightSection>
    </div>
  );
}

function InsightSection({ id, title, subtitle, children }: { id: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <div>
        <h2 id={id} className="font-heading text-base font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Horizontal money bars read in whole rupees; the tooltip carries units. */
function moneyBars(shares: MoneyShare[]): BarDatum[] {
  return shares.map((s) => ({
    label: s.name,
    value: Math.round(s.valuePaise / 100),
    hint: `${fmtMoney(s.valuePaise)} · ${fmtInt(s.count)} pcs`,
    tone: s.id === "other" ? "muted" : "primary",
  }));
}

function hourLabel(h: number): string {
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}
