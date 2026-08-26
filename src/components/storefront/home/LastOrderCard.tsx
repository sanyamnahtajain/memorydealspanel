"use client";

/**
 * LastOrderCard — a one-line glance at the signed-in customer's most recent
 * order (number, plain-English status, placed date), tapping through to the
 * order detail. Sits directly above the "Buy again" rail.
 *
 * ISR CONTRACT: the home page is a PUBLIC cached shell. This component keeps
 * it that way by fetching /api/last-order in the BROWSER after mount — the
 * viewer is resolved server-side inside that route, never here. Until data
 * arrives (and for anon / admin / no-orders / error responses) it renders
 * NOTHING AT ALL — no skeleton, no reserved space — so a logged-out visitor's
 * home page is pixel-identical to the cached shell (BuyAgainRail's pattern,
 * exactly).
 *
 * PRICE GATE: the payload carries NO money fields at all — number, status
 * label and date only. Totals live behind /account/orders/<n>.
 */

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Package } from "lucide-react";

interface LastOrderGlance {
  orderNumber: string;
  statusLabel: string;
  placedAt: string;
}

function parseGlance(data: unknown): LastOrderGlance | null {
  const order = (data as { order?: unknown } | null)?.order;
  if (
    typeof (order as LastOrderGlance | null)?.orderNumber === "string" &&
    typeof (order as LastOrderGlance).statusLabel === "string" &&
    typeof (order as LastOrderGlance).placedAt === "string"
  ) {
    return order as LastOrderGlance;
  }
  return null;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function LastOrderCard() {
  const [order, setOrder] = React.useState<LastOrderGlance | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/last-order", {
      signal: controller.signal,
      credentials: "same-origin",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const parsed = parseGlance(data);
        if (parsed) setOrder(parsed);
      })
      .catch(() => {
        // Render nothing — a broken glance must never break the home page.
      });
    return () => controller.abort();
  }, []);

  if (!order) return null;

  const placed = formatDate(order.placedAt);

  return (
    <section aria-label="Your last order" className="mt-6">
      <Link
        href={`/account/orders/${encodeURIComponent(order.orderNumber)}`}
        className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-sm ring-1 ring-foreground/5 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"
        >
          <Package className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
            Your last order
          </span>
          <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold tabular-nums text-foreground">
              #{order.orderNumber}
            </span>
            <span className="text-sm text-muted-foreground">
              {order.statusLabel}
              {placed ? ` · ${placed}` : ""}
            </span>
          </span>
        </span>
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        />
      </Link>
    </section>
  );
}
