"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { StockStatus } from "@/lib/schemas/shared";
import {
  countSelection,
  parseSelection,
  writeSelection,
  type FacetSelection,
} from "./types";

/**
 * URL-backed facet-selection state for the discovery panel.
 *
 * The URL is the single source of truth (shareable + SSR-friendly): the
 * selection is parsed from `useSearchParams()` on every render, and every
 * mutation writes back via `router.replace` (preserving unrelated params such
 * as `view` / `sort` / `q`). The `approved` flag comes from the server facet
 * payload — when false, the `band` param is never parsed OR written, so a
 * gated viewer's URL can never carry a price band.
 *
 * Toggling a facet resets to the first page implicitly: pagination lives in
 * StorefrontListing keyed on the incoming server items, which change when the
 * server re-queries for the new URL.
 */
export interface FacetSelectionApi {
  selection: FacetSelection;
  activeCount: number;
  toggleBrand: (value: string, next: boolean) => void;
  toggleSpec: (specKey: string, value: string, next: boolean) => void;
  toggleStock: (value: StockStatus, next: boolean) => void;
  toggleTag: (value: string, next: boolean) => void;
  setBand: (value: string | null) => void;
  removeBrand: (value: string) => void;
  removeSpec: (specKey: string, value: string) => void;
  removeStock: (value: StockStatus) => void;
  removeTag: (value: string) => void;
  removeBand: () => void;
  clearAll: () => void;
}

function toggleInArray<T>(arr: T[], value: T, next: boolean): T[] {
  const has = arr.includes(value);
  if (next && !has) return [...arr, value];
  if (!next && has) return arr.filter((v) => v !== value);
  return arr;
}

export function useFacetSelection(approved: boolean): FacetSelectionApi {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selection = React.useMemo(
    () => parseSelection(new URLSearchParams(searchParams.toString()), approved),
    [searchParams, approved],
  );

  const commit = React.useCallback(
    (next: FacetSelection) => {
      const params = writeSelection(
        new URLSearchParams(searchParams.toString()),
        next,
        approved,
      );
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams, approved],
  );

  const toggleBrand = React.useCallback(
    (value: string, next: boolean) =>
      commit({ ...selection, brands: toggleInArray(selection.brands, value, next) }),
    [commit, selection],
  );

  const toggleSpec = React.useCallback(
    (specKey: string, value: string, next: boolean) => {
      const current = selection.specs[specKey] ?? [];
      const updated = toggleInArray(current, value, next);
      const specs = { ...selection.specs };
      if (updated.length > 0) specs[specKey] = updated;
      else delete specs[specKey];
      commit({ ...selection, specs });
    },
    [commit, selection],
  );

  const toggleStock = React.useCallback(
    (value: StockStatus, next: boolean) =>
      commit({ ...selection, stock: toggleInArray(selection.stock, value, next) }),
    [commit, selection],
  );

  const toggleTag = React.useCallback(
    (value: string, next: boolean) =>
      commit({ ...selection, tags: toggleInArray(selection.tags, value, next) }),
    [commit, selection],
  );

  const setBand = React.useCallback(
    (value: string | null) => {
      // Never persist a band for a gated viewer.
      commit({ ...selection, band: approved ? value : null });
    },
    [commit, selection, approved],
  );

  const clearAll = React.useCallback(() => {
    commit({ brands: [], specs: {}, stock: [], tags: [], band: null });
  }, [commit]);

  return {
    selection,
    activeCount: countSelection(selection),
    toggleBrand,
    toggleSpec,
    toggleStock,
    toggleTag,
    setBand,
    removeBrand: (value) => toggleBrand(value, false),
    removeSpec: (specKey, value) => toggleSpec(specKey, value, false),
    removeStock: (value) => toggleStock(value, false),
    removeTag: (value) => toggleTag(value, false),
    removeBand: () => setBand(null),
    clearAll,
  };
}
