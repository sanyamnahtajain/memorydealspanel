"use client";

import * as React from "react";
import { Minus, Plus, Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { clampQuantity, minOrderableQty } from "@/lib/quantity";
import { searchDeviceModelsAction } from "@/server/actions/device-models";

/**
 * ModelAllocationBuilder — the "10 × Realme 11, 10 × S23 Ultra…" editor.
 *
 * Search-first by design: the model master holds hundreds of rows, so the
 * full list is never rendered. Typing runs the (rate-limited, restriction-
 * aware) server search; picking a result adds a row with a qty stepper; the
 * sticky footer shows the running total against the product's MOQ/pack rule.
 *
 * Controlled: `value` + `onChange` — the parent (add-to-cart / cart edit)
 * owns submission. This component never talks to the cart itself.
 */

export interface AllocationRow {
  modelId: string;
  name: string;
  qty: number;
}

export interface ModelAllocationBuilderProps {
  value: AllocationRow[];
  onChange: (rows: AllocationRow[]) => void;
  /** Scope searches to this product's allocation restriction. */
  productId: string;
  moq?: number | null;
  packMultiple?: number | null;
  disabled?: boolean;
  className?: string;
}

interface SearchResult {
  id: string;
  name: string;
  brandName: string | null;
}

export function ModelAllocationBuilder({
  value,
  onChange,
  productId,
  moq,
  packMultiple,
  disabled = false,
  className,
}: ModelAllocationBuilderProps) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const seq = React.useRef(0);

  // Debounced server search; a stale response never overwrites a newer one.
  React.useEffect(() => {
    if (!open) return;
    const mine = ++seq.current;
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const result = await searchDeviceModelsAction({
          query,
          productId,
          limit: 30,
        });
        if (seq.current === mine && result.ok) setResults(result.data);
      } finally {
        if (seq.current === mine) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, open, productId]);

  const chosen = new Set(value.map((r) => r.modelId));
  const total = value.reduce((acc, r) => acc + r.qty, 0);
  const floor = minOrderableQty(moq, packMultiple);
  const settled = clampQuantity(total, moq, packMultiple);
  const totalOk = total > 0 && settled === total;

  function addModel(model: SearchResult) {
    if (chosen.has(model.id)) return;
    onChange([...value, { modelId: model.id, name: model.name, qty: 1 }]);
    setQuery("");
    setOpen(false);
  }

  function setQty(modelId: string, qty: number) {
    if (qty <= 0) {
      onChange(value.filter((r) => r.modelId !== modelId));
      return;
    }
    onChange(
      value.map((r) => (r.modelId === modelId ? { ...r, qty } : r)),
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* ---- Search-first picker ---- */}
      <div className="relative">
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            disabled={disabled}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              // Delay so a click on a result lands before the list closes.
              setTimeout(() => setOpen(false), 150);
            }}
            placeholder="Search phone model… e.g. Realme 11, S23 Ultra"
            className="h-10 pl-8"
            aria-label="Search device models"
          />
          {searching ? (
            <Spinner className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2" />
          ) : null}
        </div>

        {open && (query.trim() !== "" || results.length > 0) ? (
          <ul
            role="listbox"
            aria-label="Matching models"
            className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
          >
            {results.length === 0 && !searching ? (
              <li className="px-2.5 py-2 text-sm text-muted-foreground">
                No models match “{query}”.
              </li>
            ) : (
              results.map((m) => {
                const taken = chosen.has(m.id);
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={taken}
                      disabled={taken}
                      // onMouseDown so it beats the input's blur-close.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        addModel(m);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm",
                        taken
                          ? "cursor-default text-muted-foreground"
                          : "hover:bg-muted",
                      )}
                    >
                      <span className="truncate">{m.name}</span>
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        {taken ? "Added" : m.brandName ?? ""}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        ) : null}
      </div>

      {/* ---- Chosen models ---- */}
      {value.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          Search and add the models you need, then set a quantity for each.
        </p>
      ) : (
        <ul className="flex max-h-72 flex-col gap-1.5 overflow-auto">
          {value.map((row) => (
            <li
              key={row.modelId}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
              <div className="inline-flex items-center rounded-md border border-border">
                <button
                  type="button"
                  aria-label={`Fewer ${row.name}`}
                  disabled={disabled}
                  onClick={() => setQty(row.modelId, row.qty - 1)}
                  className="inline-flex size-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                >
                  <Minus aria-hidden className="size-3.5" />
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  aria-label={`Quantity for ${row.name}`}
                  value={row.qty}
                  disabled={disabled}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/[^\d]/g, "");
                    if (digits === "") return setQty(row.modelId, 1);
                    setQty(row.modelId, Math.min(100_000, Number(digits)));
                  }}
                  className="h-8 w-12 border-x border-border bg-transparent text-center text-sm tabular-nums outline-none focus-visible:bg-muted/40"
                />
                <button
                  type="button"
                  aria-label={`More ${row.name}`}
                  disabled={disabled}
                  onClick={() => setQty(row.modelId, row.qty + 1)}
                  className="inline-flex size-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                >
                  <Plus aria-hidden className="size-3.5" />
                </button>
              </div>
              <button
                type="button"
                aria-label={`Remove ${row.name}`}
                disabled={disabled}
                onClick={() => setQty(row.modelId, 0)}
                className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                <X aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ---- Running total vs the MOQ / pack rule ---- */}
      <div
        className={cn(
          "flex items-center justify-between rounded-lg px-3 py-2 text-sm",
          totalOk
            ? "bg-success/10 text-success"
            : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
        )}
        aria-live="polite"
      >
        <span className="font-medium tabular-nums">Total: {total}</span>
        <span className="text-xs">
          {total === 0
            ? `Minimum ${floor}`
            : totalOk
              ? "Ready to add"
              : total < floor
                ? `Add ${floor - total} more (minimum ${floor})`
                : `Round up to ${settled}${
                    packMultiple && packMultiple > 1
                      ? ` (packs of ${packMultiple})`
                      : ""
                  }`}
        </span>
      </div>
    </div>
  );
}
