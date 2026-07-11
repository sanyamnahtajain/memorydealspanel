"use client";

/**
 * ProductGrid — the client surface that wires the generic DealSheet engine to
 * real products.
 *
 * The contract with the grid is just "columns + onSave" (see
 * `@/components/grid/README.md`). This component:
 *   - builds product columns from the live category list,
 *   - adapts the grid's `(rowId, patch)` callback to the `saveProductField`
 *     server action (money is already integer paise on both sides),
 *   - surfaces a hard failure as a sonner toast AND rejects the promise so the
 *     grid rolls the optimistic edit back and shows its Retry chip,
 *   - opens the full product editor when an image cell is activated,
 *   - and renders the mobile card editor below the `md` breakpoint.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { DealSheet, MobileCardEditor } from "@/components/grid";
import type { OnSave } from "@/components/grid/types";
import { EmptyState, useIsMobile } from "@/components/common";
import type { CategoryDTO } from "@/server/dal/categories";
import type { BrandOption } from "@/server/services/brands";
import { saveProductField } from "@/server/actions/products";

import { buildProductColumns, type ProductRow } from "./productColumns";
import { toUpdateInput } from "./adapters";

export interface ProductGridProps {
  /** Initial rows, already projected from `PricedProduct` on the server. */
  rows: ProductRow[];
  /** All categories (admin list) for the colored category select. */
  categories: CategoryDTO[];
  /** Active brands (Brand master) for the brand select column. */
  brands: BrandOption[];
}

/** Stable grid id — namespaces saved views in localStorage. */
const GRID_ID = "products";

export function ProductGrid({ rows, categories, brands }: ProductGridProps) {
  const router = useRouter();
  const isMobile = useIsMobile();

  const columns = React.useMemo(
    () => buildProductColumns(categories, brands),
    [categories, brands],
  );

  /**
   * Persist a single-cell (or bulk) edit via the audited server action.
   * Resolves on success; on a hard failure it toasts and REJECTS so the grid
   * reverts the optimistic write and offers Retry.
   */
  const onSave = React.useCallback<OnSave<ProductRow>>(
    async (rowId, patch) => {
      const input = toUpdateInput(patch);
      if (!input) return; // nothing persistable (e.g. a computed-only change)

      const result = await saveProductField(rowId, input);
      if (!result.ok) {
        toast.error("Couldn't save", { description: result.error });
        throw new Error(result.error);
      }
    },
    [],
  );

  /** Image cell → open the full product editor where images are managed. */
  const onOpenImages = React.useCallback(
    (rowId: string) => {
      router.push(`/admin/products/${rowId}`);
    },
    [router],
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        illustration="empty-box"
        title="No products yet"
        description="Products you add will appear here, ready to price and publish."
      />
    );
  }

  const gridProps = {
    gridId: GRID_ID,
    rows,
    columns,
    onSave,
    onOpenImages,
  } as const;

  return isMobile ? (
    <MobileCardEditor {...gridProps} />
  ) : (
    <DealSheet {...gridProps} />
  );
}
