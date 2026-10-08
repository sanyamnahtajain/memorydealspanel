"use client";

import * as React from "react";
import { Loader2, Package, Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { searchProductsForReelAction } from "@/server/actions/reels";
import type { ReelProductPick } from "@/server/services/reels";

/**
 * "This reel sells…" — a debounced product search that collapses to a chip
 * once a product is chosen. Price-free: the picker shows name, SKU and the
 * thumbnail only, exactly what the storefront reel will show.
 */

const DEBOUNCE_MS = 250;
const MIN_QUERY = 2;

export interface PickedProduct {
  id: string;
  name: string;
  sku?: string;
  imageUrl: string | null;
}

export function ReelProductPicker({
  value,
  onChange,
  disabled,
}: {
  value: PickedProduct | null;
  onChange: (product: PickedProduct | null) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<ReelProductPick[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const requestId = React.useRef(0);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const listboxId = React.useId();

  // Cancel a pending search when the picker unmounts (dialog closed mid-type).
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      requestId.current += 1;
    },
    [],
  );

  function onQueryChange(next: string) {
    setQuery(next);
    if (timer.current) clearTimeout(timer.current);
    const q = next.trim();
    // Bumping the id invalidates any search already in flight.
    const id = ++requestId.current;
    if (q.length < MIN_QUERY) {
      setResults([]);
      setSearching(false);
      setError(null);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      const res = await searchProductsForReelAction(q);
      // A slower, older request must not overwrite a newer result.
      if (id !== requestId.current) return;
      setSearching(false);
      if (!res.ok) {
        setError(res.error);
        setResults([]);
        return;
      }
      setError(null);
      setResults(res.products);
    }, DEBOUNCE_MS);
  }

  if (value) {
    return (
      <div className="space-y-1.5">
        <Label>Product it sells</Label>
        <div className="flex items-center gap-3 rounded-lg border border-input bg-muted/30 p-2 pr-2.5">
          <Thumb src={value.imageUrl} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {value.name}
            </p>
            {value.sku ? (
              <p className="truncate text-xs text-muted-foreground">
                SKU {value.sku}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Remove product link"
            disabled={disabled}
            onClick={() => onChange(null)}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Shoppers get a &ldquo;Shop this&rdquo; button that opens the product
          page.
        </p>
      </div>
    );
  }

  const q = query.trim();
  const showList = q.length >= MIN_QUERY;

  return (
    <div className="space-y-1.5">
      <Label htmlFor="reel-product-search">Product it sells (optional)</Label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id="reel-product-search"
          value={query}
          disabled={disabled}
          placeholder="Search by name, SKU or brand"
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listboxId}
          className="pl-9"
          onChange={(e) => onQueryChange(e.target.value)}
        />
        {searching ? (
          <Loader2
            className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden
          />
        ) : null}
      </div>

      {showList ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Matching products"
          className="max-h-60 overflow-y-auto rounded-lg border border-border bg-card shadow-sm"
        >
          {error ? (
            <p className="px-3 py-3 text-sm text-destructive">{error}</p>
          ) : results.length === 0 && !searching ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              No active product matches &ldquo;{q}&rdquo;.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {results.map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => {
                      onChange({
                        id: product.id,
                        name: product.name,
                        sku: product.sku,
                        imageUrl: product.imageUrl,
                      });
                      setQuery("");
                      setResults([]);
                    }}
                    className="flex w-full items-center gap-3 px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  >
                    <Thumb src={product.imageUrl} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {product.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        SKU {product.sku}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Type at least two letters. Only active products are offered.
        </p>
      )}
    </div>
  );
}

function Thumb({ src }: { src: string | null }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/60">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-contain p-0.5" />
      ) : (
        <Package className="size-4 text-muted-foreground" aria-hidden />
      )}
    </span>
  );
}
