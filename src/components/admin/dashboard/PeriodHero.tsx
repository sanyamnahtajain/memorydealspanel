import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, CalendarRange, MinusIcon, Sun, TrendingDownIcon, TrendingUpIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Stagger } from "@/components/motion/primitives";
import type { CalendarPeriods } from "@/server/services/dashboard-insights";
import { fmtInt, fmtMoney, pctDelta } from "./insights-format";

/**
 * The owner's by-name numbers: today, this week, this month — each with the
 * honest comparison (yesterday, last week to the same moment, last month to
 * the same day) and the order count under the money. Server component.
 */
export function PeriodHero({ periods }: { periods: CalendarPeriods }) {
  const cards = [
    {
      key: "today",
      label: "Today",
      icon: <Sun aria-hidden />,
      value: fmtMoney(periods.today.valuePaise, true),
      orders: periods.today.orders,
      delta: pctDelta(periods.today.valuePaise, periods.yesterday.valuePaise),
      deltaLabel: `vs yesterday (${fmtMoney(periods.yesterday.valuePaise, true)})`,
    },
    {
      key: "week",
      label: "This week",
      icon: <CalendarRange aria-hidden />,
      value: fmtMoney(periods.thisWeek.valuePaise, true),
      orders: periods.thisWeek.orders,
      delta: pctDelta(periods.thisWeek.valuePaise, periods.lastWeekToDate.valuePaise),
      deltaLabel: "vs same point last week",
    },
    {
      key: "month",
      label: "This month",
      icon: <CalendarDays aria-hidden />,
      value: fmtMoney(periods.thisMonth.valuePaise, true),
      orders: periods.thisMonth.orders,
      delta: pctDelta(periods.thisMonth.valuePaise, periods.lastMonthToDate.valuePaise),
      deltaLabel: `vs same point last month · last month ${fmtMoney(periods.lastMonth.valuePaise, true)}`,
    },
  ];

  return (
    <section aria-labelledby="period-hero-heading">
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 id="period-hero-heading" className="font-heading text-base font-semibold tracking-tight text-foreground">
          Trade by period
        </h2>
        <Link
          href="/admin/orders"
          className="inline-flex shrink-0 items-center gap-0.5 rounded-md text-xs font-medium text-primary transition-fast hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          All orders
          <ArrowUpRight aria-hidden className="size-3.5" />
        </Link>
      </div>
      <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4" itemClassName="min-w-0">
        {cards.map((card) => (
          <div
            key={card.key}
            className="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{card.label}</p>
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground [&_svg]:size-4"
              >
                {card.icon}
              </span>
            </div>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="font-tabular text-2xl font-semibold tracking-tight text-foreground">{card.value}</span>
              <span className="font-tabular text-xs text-muted-foreground">
                {fmtInt(card.orders)} {card.orders === 1 ? "order" : "orders"}
              </span>
            </p>
            <Delta delta={card.delta} label={card.deltaLabel} />
          </div>
        ))}
      </Stagger>
    </section>
  );
}

/** The comparison line: arrow + signed percent in the status colour, caption in ink. */
function Delta({ delta, label }: { delta: number | undefined; label: string }) {
  if (delta === undefined) {
    return <p className="mt-1.5 text-xs text-muted-foreground">{label}</p>;
  }
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const Icon = direction === "up" ? TrendingUpIcon : direction === "down" ? TrendingDownIcon : MinusIcon;
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 font-tabular font-medium",
          direction === "up" && "text-success",
          direction === "down" && "text-destructive",
          direction === "flat" && "text-muted-foreground",
        )}
      >
        <Icon className="size-3.5" aria-hidden />
        {delta > 0 ? "+" : ""}
        {delta}%
      </span>
      <span className="text-muted-foreground">{label}</span>
    </p>
  );
}
