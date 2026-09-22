import * as React from "react";
import { History } from "lucide-react";

import { formatPaise } from "@/lib/money";
import type { OrderRevisionDTO } from "@/lib/order-edits";
import { OrderChangesList } from "./OrderChangesList";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * An order's edit history, newest first. Shared by the admin detail page and
 * the customer's order page; money shows only where the server put it
 * (`payablePaise` is null for a price-gated viewer).
 */
export function OrderRevisionList({
  revisions,
  viewer,
}: {
  revisions: readonly OrderRevisionDTO[];
  /** Who is looking — decides how the actor is named ("You" vs "The shop"). */
  viewer: "admin" | "customer";
}) {
  if (revisions.length === 0) return null;
  return (
    <section aria-labelledby="order-history-heading" className="space-y-3">
      <h2
        id="order-history-heading"
        className="flex items-center gap-1.5 text-sm font-semibold text-foreground"
      >
        <History className="size-4 text-muted-foreground" aria-hidden />
        Changes after placement
      </h2>
      <ol className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {revisions.map((rev) => {
          const who =
            rev.actorType === "admin"
              ? viewer === "admin"
                ? "Staff"
                : "The shop"
              : viewer === "customer"
                ? "You"
                : "Customer";
          const before = rev.before?.payablePaise;
          const after = rev.after?.payablePaise;
          return (
            <li key={rev.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-foreground">
                  {who} edited this order
                  <span className="text-muted-foreground"> · v{rev.version}</span>
                </p>
                <time dateTime={rev.createdAt} className="text-xs text-muted-foreground">
                  {formatDateTime(rev.createdAt)}
                </time>
              </div>
              {rev.reason ? (
                <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                  “{rev.reason}”
                </p>
              ) : null}
              <OrderChangesList changes={rev.changes} className="space-y-1" />
              {typeof before === "number" && typeof after === "number" && before !== after ? (
                <p className="text-xs tabular-nums text-muted-foreground">
                  Payable {formatPaise(before)} → {formatPaise(after)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
