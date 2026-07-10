"use client";

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Pager } from "@/components/common";
import type { SessionKind } from "@/server/services/sessions";
import { SessionsTable } from "./SessionsTable";
import type { SessionRowData } from "./types";

export interface SessionsTabsProps {
  kind: SessionKind;
  rows: SessionRowData[];
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  /** Active counts per tab, for the header badges. */
  adminActive: number;
  customerActive: number;
}

/**
 * URL-driven tab switcher for the Sessions viewer. The active tab is the
 * `?kind=` search param so the SERVER filters + paginates each list (keeping
 * the admin guard authoritative) and the shared {@link Pager} works per-tab.
 * Switching tabs resets pagination to page 1.
 */
export function SessionsTabs({
  kind,
  rows,
  page,
  pageCount,
  total,
  pageSize,
  adminActive,
  customerActive,
}: SessionsTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const onTabChange = React.useCallback(
    (next: string) => {
      if (next === kind) return;
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("kind", next);
      // A new tab means a new list — drop the page cursor.
      params.delete("page");
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [kind, pathname, router, searchParams],
  );

  return (
    <Tabs value={kind} onValueChange={onTabChange} className="w-full">
      <TabsList>
        <TabsTrigger value="admin">
          Admins
          <CountBadge value={adminActive} />
        </TabsTrigger>
        <TabsTrigger value="customer">
          Customers
          <CountBadge value={customerActive} />
        </TabsTrigger>
      </TabsList>

      <TabsContent value={kind} className="mt-6 space-y-4">
        <SessionsTable
          rows={rows}
          emptyTitle={
            kind === "admin" ? "No admin sessions" : "No customer sessions"
          }
          emptyDescription={
            kind === "admin"
              ? "Admin sign-ins will appear here."
              : "Customer sign-ins will appear here."
          }
        />
        {total > 0 ? (
          <Pager
            page={page}
            pageCount={pageCount}
            total={total}
            pageSize={pageSize}
          />
        ) : null}
      </TabsContent>
    </Tabs>
  );
}

function CountBadge({ value }: { value: number }) {
  if (value <= 0) return null;
  return (
    <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] leading-none font-semibold tabular-nums text-primary-foreground">
      {value}
    </span>
  );
}
