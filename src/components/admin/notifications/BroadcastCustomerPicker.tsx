"use client";

import * as React from "react";
import { Check, RotateCcw, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  listCustomersAction,
  type CustomerRow,
} from "@/server/actions/customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState, StatusChip, type StatusChipVariant } from "@/components/common";

/**
 * Pick ONE customer to message.
 *
 * Reuses the admin customer search that already backs the customer table
 * (`listCustomersAction`, which matches business name / contact / phone) rather
 * than inventing a second search with different rules — the results a person
 * sees here are the same rows they'd see on /admin/customers.
 *
 * Keyboard and thumb both work: it is a plain text input plus a result list of
 * real buttons (never a native <select>, never a datalist), and the chosen
 * customer collapses into a removable summary row so the composer stays short
 * on a phone.
 */

const SEARCH_DEBOUNCE_MS = 250;
const RESULT_LIMIT = 8;

const STATUS_VARIANT: Record<CustomerRow["status"], StatusChipVariant> = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  EXPIRED: "expired",
  BLOCKED: "blocked",
};

export interface BroadcastCustomerPickerProps {
  selected: CustomerRow | null;
  onSelect: (customer: CustomerRow | null) => void;
  disabled?: boolean;
}

export function BroadcastCustomerPicker({
  selected,
  onSelect,
  disabled = false,
}: BroadcastCustomerPickerProps) {
  const [query, setQuery] = React.useState("");
  const [rows, setRows] = React.useState<CustomerRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** Bumped to re-run the current search after a failure. */
  const [attempt, setAttempt] = React.useState(0);

  const trimmed = query.trim();

  // Everything runs from the debounce timer, never straight from the effect
  // body: a keystroke should not trigger a cascading re-render, and the query
  // is only worth sending once typing pauses.
  React.useEffect(() => {
    if (selected) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      if (trimmed.length < 2) {
        setRows([]);
        setError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      void (async () => {
        try {
          const res = await listCustomersAction({
            search: trimmed,
            take: RESULT_LIMIT,
          });
          if (cancelled) return;
          if (res.ok) {
            setRows(res.customers);
            setError(null);
          } else {
            setRows([]);
            setError(res.error);
          }
        } catch {
          if (!cancelled) {
            setRows([]);
            setError("Could not search customers.");
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, attempt, selected]);

  if (selected) {
    return (
      <div className="space-y-1.5">
        <Label>Customer</Label>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary [&_svg]:size-3.5"
          >
            <Check />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {selected.businessName}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {selected.contactName} · {selected.phone}
            </p>
          </div>
          <StatusChip variant={STATUS_VARIANT[selected.status]} />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            onClick={() => {
              onSelect(null);
              setQuery("");
            }}
            aria-label="Choose a different customer"
          >
            <X aria-hidden />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="broadcast-customer-search">Search for the customer</Label>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id="broadcast-customer-search"
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Shop name or phone number"
          autoComplete="off"
          className="pl-8"
        />
        {loading ? (
          <Spinner
            size="xs"
            className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground"
          />
        ) : null}
      </div>

      {trimmed.length > 0 && trimmed.length < 2 ? (
        <p className="text-xs text-muted-foreground">
          Type at least 2 letters to search.
        </p>
      ) : null}

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-sm text-destructive">{error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAttempt((n) => n + 1)}
          >
            <RotateCcw aria-hidden />
            Try again
          </Button>
        </div>
      ) : null}

      {!error && !loading && trimmed.length >= 2 && rows.length === 0 ? (
        <EmptyState
          illustration="no-results"
          title="No customer found"
          description="Check the spelling, or try the phone number instead."
        />
      ) : null}

      {rows.length > 0 ? (
        <ul className="overflow-hidden rounded-lg border border-border">
          {rows.map((row, index) => (
            <li key={row.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(row)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-50",
                  index > 0 && "border-t border-border",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {row.businessName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.contactName} · {row.phone}
                  </p>
                </div>
                <StatusChip variant={STATUS_VARIANT[row.status]} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
