"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table } from "@/components/ui/table";
import { StatusChip, type StatusChipVariant, EmptyState, Pager } from "@/components/common";
import { useIsMobile } from "@/components/common";
import {
  ExpiryDial,
  expiryValueToInput,
  type ExpiryValue,
} from "@/components/admin/ExpiryDial";
import {
  bulkApproveAccessAction,
  bulkExtendAccessAction,
  bulkRevokeAccessAction,
} from "@/server/actions/access";
import { CustomerProfileDrawer } from "./CustomerProfileDrawer";
import type { CustomerRowData } from "@/app/admin/customers/page";
import type { CustomerStatus } from "@/lib/schemas/shared";

const STATUS_VARIANT: Record<CustomerStatus, StatusChipVariant> = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  EXPIRED: "expired",
  BLOCKED: "blocked",
};

const FILTERS: { key: CustomerStatus | "ALL"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "PENDING", label: "Pending" },
  { key: "APPROVED", label: "Approved" },
  { key: "EXPIRED", label: "Expired" },
  { key: "REJECTED", label: "Rejected" },
  { key: "BLOCKED", label: "Blocked" },
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function CustomerTable({
  rows,
  counts,
  activeStatus,
  search,
  page,
  pageCount,
  total,
  pageSize,
}: {
  rows: CustomerRowData[];
  counts: Record<CustomerStatus, number>;
  activeStatus: CustomerStatus | null;
  search: string;
  /** 1-based current page (from ?page=). */
  page: number;
  /** Total pages for the active filter/search. */
  pageCount: number;
  /** Total rows matching the active filter/search. */
  total: number;
  /** Page size used for the range summary. */
  pageSize: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useIsMobile();

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [drawerFor, setDrawerFor] = React.useState<CustomerRowData | null>(null);
  const [query, setQuery] = React.useState(search);
  const [bulkExpiry, setBulkExpiry] = React.useState<ExpiryValue>({ kind: "days", days: 30 });
  const [busy, setBusy] = React.useState(false);

  const selectedIds = React.useMemo(() => [...selected], [selected]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyFilter(key: CustomerStatus | "ALL") {
    const params = new URLSearchParams();
    if (key !== "ALL") params.set("status", key);
    if (query) params.set("q", query);
    router.push(`${pathname}?${params.toString()}`);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (activeStatus) params.set("status", activeStatus);
    if (query) params.set("q", query);
    router.push(`${pathname}?${params.toString()}`);
  }

  async function runBulk(
    label: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
  ) {
    setBusy(true);
    try {
      const res = await fn();
      if (res.ok) {
        toast.success(label);
        setSelected(new Set());
        router.refresh();
      } else {
        toast.error(res.error ?? "Bulk action failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  const bulkApprove = () =>
    runBulk(`Approved ${selectedIds.length}`, () =>
      bulkApproveAccessAction({
        customerIds: selectedIds,
        expiry: expiryValueToInput(bulkExpiry),
      }),
    );
  const bulkExtend = () =>
    runBulk(`Extended ${selectedIds.length}`, () =>
      bulkExtendAccessAction({
        customerIds: selectedIds,
        expiry: expiryValueToInput(bulkExpiry),
      }),
    );
  const bulkRevoke = () =>
    runBulk(`Revoked ${selectedIds.length}`, () =>
      bulkRevokeAccessAction({ customerIds: selectedIds }),
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
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors ${
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {f.label}
                {count !== undefined && (
                  <span className="text-xs opacity-70">{count}</span>
                )}
              </button>
            );
          })}
        </div>
        <form onSubmit={submitSearch} className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search business / phone"
            className="pl-8 sm:w-64"
          />
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          illustration="no-results"
          title="No customers"
          description="No customers match this filter yet."
        />
      ) : isMobile ? (
        <ul className="space-y-2">
          {rows.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setDrawerFor(c)}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left"
              >
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={(e) => {
                    e.stopPropagation();
                    toggle(c.id);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="size-4 accent-primary"
                  aria-label={`Select ${c.businessName}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.businessName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.phone} · {c.expiresAt ? `expires ${formatDate(c.expiresAt)}` : "—"}
                  </p>
                </div>
                <StatusChip variant={STATUS_VARIANT[c.status]} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2" />
                <th className="px-3 py-2 text-left font-medium">Business</th>
                <th className="px-3 py-2 text-left font-medium">Contact</th>
                <th className="px-3 py-2 text-left font-medium">Phone</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Expiry</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setDrawerFor(c)}
                  className="cursor-pointer border-t border-border hover:bg-muted/40"
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      className="size-4 accent-primary"
                      aria-label={`Select ${c.businessName}`}
                    />
                  </td>
                  <td className="px-3 py-2 font-medium">{c.businessName}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.contactName}</td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{c.phone}</td>
                  <td className="px-3 py-2">
                    <StatusChip variant={STATUS_VARIANT[c.status]} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {c.expiresAt ? formatDate(c.expiresAt) : c.priceAccess ? "No expiry" : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {rows.length > 0 ? (
        <Pager
          page={page}
          pageCount={pageCount}
          total={total}
          pageSize={pageSize}
        />
      ) : null}

      {/* Floating bulk-action bar */}
      <AnimatePresence>
        {selectedIds.length > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-[calc(100%-2rem)] max-w-2xl flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-lg sm:flex-row sm:items-center"
          >
            <span className="text-sm font-medium">{selectedIds.length} selected</span>
            <div className="flex-1">
              <ExpiryDial value={bulkExpiry} onChange={setBulkExpiry} compact />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={bulkApprove} disabled={busy}>
                Approve
              </Button>
              <Button size="sm" variant="secondary" onClick={bulkExtend} disabled={busy}>
                Extend
              </Button>
              <Button size="sm" variant="outline" onClick={bulkRevoke} disabled={busy}>
                Revoke
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelected(new Set())}
                disabled={busy}
              >
                Clear
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <CustomerProfileDrawer
        key={drawerFor?.id ?? "closed"}
        customer={drawerFor}
        open={drawerFor !== null}
        onOpenChange={(open) => {
          if (!open) setDrawerFor(null);
        }}
      />
    </div>
  );
}
