"use client";

/**
 * OrderQueueTable — the admin orders queue.
 *
 * URL-driven status filter chips (with counts) + a search box (business /
 * phone / order number), a responsive body (a proper table on desktop, tappable
 * cards on mobile), and the shared Pager. Rows link to the order detail. A
 * "new" (PLACED) order is subtly emphasised so the wholesaler spots fresh
 * requests.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { SearchIcon } from "lucide-react";
import type { OrderStatus } from "@prisma/client";

import { cn } from "@/lib/utils";
import { formatPaise } from "@/lib/money";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusChip } from "@/components/common/StatusChip";
import { EmptyState } from "@/components/common/EmptyState";
import { Pager } from "@/components/common/Pager";
import { useIsMobile } from "@/components/common/use-is-mobile";
import {
  ORDER_STATUS_LABEL,
  orderStatusVariant,
} from "@/components/storefront/orders/order-status";
import type { OrderRowDTO } from "@/server/actions/admin-orders";

const FILTERS: { key: OrderStatus | "ALL"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "PLACED", label: "New" },
  { key: "CONFIRMED", label: "Confirmed" },
  { key: "PROCESSING", label: "Processing" },
  { key: "FULFILLED", label: "Fulfilled" },
  { key: "CANCELLED", label: "Cancelled" },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function OrderQueueTable({
  rows,
  counts,
  activeStatus,
  search,
  page,
  pageCount,
  total,
  pageSize,
}: {
  rows: OrderRowDTO[];
  counts: Record<OrderStatus, number>;
  activeStatus: OrderStatus | null;
  search: string;
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const [query, setQuery] = React.useState(search);

  const applyFilter = React.useCallback(
    (key: OrderStatus | "ALL") => {
      const params = new URLSearchParams();
      if (key !== "ALL") params.set("status", key);
      if (query) params.set("q", query);
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, query, router],
  );

  const submitSearch = React.useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const params = new URLSearchParams();
      if (activeStatus) params.set("status", activeStatus);
      if (query) params.set("q", query);
      router.push(`${pathname}?${params.toString()}`);
    },
    [activeStatus, pathname, query, router],
  );

  return (
    <div className="space-y-4">
      {/* Filter chips + search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const isActive =
              f.key === "ALL" ? activeStatus === null : activeStatus === f.key;
            const count = f.key === "ALL" ? undefined : counts[f.key];
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => applyFilter(f.key)}
                className={cn(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                {f.label}
                {count !== undefined ? (
                  <span className="text-xs opacity-70 tabular-nums">{count}</span>
                ) : null}
              </button>
            );
          })}
        </div>
        <form onSubmit={submitSearch} className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search business / phone / #order"
            className="pl-8 sm:w-72"
          />
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          illustration="no-results"
          title="No orders"
          description="No orders match this filter yet."
        />
      ) : isMobile ? (
        <ul className="space-y-2">
          {rows.map((o) => (
            <li key={o.id}>
              <Link
                href={`/admin/orders/${o.id}`}
                className={cn(
                  "flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  o.status === "PLACED" ? "border-primary/40" : "border-border",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium tabular-nums">
                    #{o.orderNumber}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {o.customer?.businessName ?? "—"} · {formatDate(o.placedAt)}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {o.itemCount} {o.itemCount === 1 ? "item" : "items"} ·{" "}
                    {formatPaise(o.subtotalPaise)}
                  </p>
                </div>
                <StatusChip
                  variant={orderStatusVariant(o.status)}
                  label={ORDER_STATUS_LABEL[o.status]}
                />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader className="bg-muted/50 text-xs text-muted-foreground">
              <TableRow>
                <TableHead className="text-left font-medium">Order</TableHead>
                <TableHead className="text-left font-medium">Customer</TableHead>
                <TableHead className="text-left font-medium">Placed</TableHead>
                <TableHead className="text-right font-medium">Items</TableHead>
                <TableHead className="text-right font-medium">Total</TableHead>
                <TableHead className="text-left font-medium">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => router.push(`/admin/orders/${o.id}`)}
                  className={cn(
                    "cursor-pointer border-t border-border hover:bg-muted/40",
                    o.status === "PLACED" && "bg-primary/5",
                  )}
                >
                  <td className="px-3 py-2 font-medium tabular-nums">
                    #{o.orderNumber}
                  </td>
                  <td className="px-3 py-2">
                    <span className="block max-w-52 truncate">
                      {o.customer?.businessName ?? "—"}
                    </span>
                    <span className="block max-w-52 truncate text-xs text-muted-foreground tabular-nums">
                      {o.customer?.phone ?? ""}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatDate(o.placedAt)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {o.itemCount}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatPaise(o.subtotalPaise)}
                  </td>
                  <td className="px-3 py-2">
                    <StatusChip
                      variant={orderStatusVariant(o.status)}
                      label={ORDER_STATUS_LABEL[o.status]}
                    />
                  </td>
                </tr>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {rows.length > 0 ? (
        <Pager page={page} pageCount={pageCount} total={total} pageSize={pageSize} />
      ) : null}
    </div>
  );
}
