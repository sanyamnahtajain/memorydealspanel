"use client";

/**
 * OrderAbuseView — a lazy-loaded velocity/abuse panel: the busiest customers by
 * order volume, with a trailing-24h count so rapid repeat placement stands out.
 * Loaded on demand from the guarded `orderAbuseViewAction` (so the queue page
 * stays fast) with skeleton / empty / error states.
 */

import * as React from "react";
import { AlertTriangleIcon, RefreshCwIcon } from "lucide-react";

import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/common/EmptyState";
import {
  orderAbuseViewAction,
  type CustomerVolumeDTO,
} from "@/server/actions/admin-orders";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: CustomerVolumeDTO[] };

export function OrderAbuseView() {
  const [state, setState] = React.useState<State>({ kind: "idle" });

  const load = React.useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await orderAbuseViewAction(20);
      if (!res.ok) {
        setState({ kind: "error", message: res.error });
        return;
      }
      setState({ kind: "ready", rows: res.rows });
    } catch {
      setState({ kind: "error", message: "Couldn't load the abuse view." });
    }
  }, []);

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertTriangleIcon className="size-4 text-warning" aria-hidden />
            Order velocity
          </h2>
          <p className="text-xs text-muted-foreground">
            Busiest customers — a high 24h count can signal abuse.
          </p>
        </div>
        {state.kind === "ready" ? (
          <Button variant="ghost" size="icon-sm" onClick={load} aria-label="Refresh">
            <RefreshCwIcon aria-hidden />
          </Button>
        ) : null}
      </div>

      {state.kind === "idle" ? (
        <Button variant="outline" size="sm" onClick={load}>
          Load velocity
        </Button>
      ) : null}

      {state.kind === "loading" ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Spinner size="sm" label="" />
          Loading…
        </div>
      ) : null}

      {state.kind === "error" ? (
        <div className="space-y-2 py-2">
          <p className="text-sm text-destructive">{state.message}</p>
          <Button variant="outline" size="sm" onClick={load}>
            Retry
          </Button>
        </div>
      ) : null}

      {state.kind === "ready" ? (
        state.rows.length === 0 ? (
          <EmptyState
            illustration="no-results"
            title="No orders yet"
            description="Velocity will populate once customers start ordering."
            className="py-6"
          />
        ) : (
          <ul className="divide-y divide-border">
            {state.rows.map((r) => (
              <li
                key={r.customer.id}
                className="flex items-center gap-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {r.customer.businessName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground tabular-nums">
                    {r.customer.phone}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums">
                    {r.totalOrders} orders
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatPaise(r.totalValuePaise)}
                  </p>
                </div>
                <span
                  className={
                    "ml-1 inline-flex min-w-9 shrink-0 items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums " +
                    (r.last24h >= 3
                      ? "bg-destructive/10 text-destructive"
                      : r.last24h > 0
                        ? "bg-warning/15 text-warning-foreground dark:text-warning"
                        : "bg-muted text-muted-foreground")
                  }
                  title={`${r.last24h} in the last 24h`}
                >
                  {r.last24h}/24h
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
