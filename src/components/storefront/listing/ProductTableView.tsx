"use client";

/**
 * ProductTableView — a dense, sortable, sticky-header table.
 *
 * PRICE-GATE — THE SACRED RULE: for a NON-APPROVED viewer this table renders
 * NO price value in the price column. Instead the price cell shows the locked
 * PriceGate chip (the server-built `priceSlot`, which is a locked chip for
 * gated viewers). The header is still labelled "Price" but the column carries
 * only the lock affordance — never an amount. The price column is NOT dropped
 * (so the layout is stable) but it is guaranteed price-free unless the viewer
 * is approved, because the slot itself is the gate.
 *
 * The price header is sortable ONLY when `canSortPrice` is true (an approved
 * viewer): sorting by price is meaningless — and impossible — without prices.
 *
 * Horizontal scroll on narrow screens; sticky header on tall lists.
 */

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowDown, ArrowUp, ChevronsUpDown, ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { StatusChip } from "@/components/common/StatusChip";
import type { ListingItem, SortKey } from "./types";
import { keySpec, stockChipVariant, thumbUrl } from "./product-display";

interface ProductTableViewProps {
  items: ListingItem[];
  /** Current global sort key (drives the header sort indicators). */
  sort: SortKey;
  /** Change the sort; the parent re-queries/re-sorts and re-renders. */
  onSort: (key: SortKey) => void;
  /** Whether price sorting is available (approved viewer). */
  canSortPrice: boolean;
}

/**
 * Which sort key a column toggles to. A column with two keys toggles between
 * ascending/descending; `null` columns are not sortable (server sorts only by
 * the keys the DAL supports — name / newest / price).
 */
interface Column {
  id: string;
  label: string;
  /** Ascending sort key, if this column is sortable. */
  asc?: SortKey;
  /** Descending sort key, if this column supports both directions. */
  desc?: SortKey;
  className?: string;
  headClassName?: string;
}

export function ProductTableView({
  items,
  sort,
  onSort,
  canSortPrice,
}: ProductTableViewProps) {
  const columns: Column[] = [
    { id: "image", label: "", headClassName: "w-14" },
    { id: "name", label: "Name", asc: "name" },
    { id: "sku", label: "SKU", className: "hidden md:table-cell" },
    { id: "brand", label: "Brand", className: "hidden lg:table-cell" },
    { id: "spec", label: "Key spec", className: "hidden lg:table-cell" },
    {
      id: "price",
      label: "Price",
      // Price sort only for approved viewers; otherwise a plain header.
      asc: canSortPrice ? "price-asc" : undefined,
      desc: canSortPrice ? "price-desc" : undefined,
      headClassName: "text-right",
      className: "text-right",
    },
    { id: "moq", label: "MOQ", className: "hidden text-right sm:table-cell", headClassName: "text-right" },
    { id: "stock", label: "Stock", headClassName: "text-right", className: "text-right" },
  ];

  return (
    <div className="overflow-x-auto overscroll-x-contain rounded-xl border border-border bg-card">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead className="sticky top-14 z-10 bg-card/95 backdrop-blur md:top-16">
          <tr className="border-b border-border">
            {columns.map((col) => (
              <SortableHeader
                key={col.id}
                column={col}
                sort={sort}
                onSort={onSort}
              />
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((item) => (
            <TableRow key={item.product.id} item={item} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortableHeader({
  column,
  sort,
  onSort,
}: {
  column: Column;
  sort: SortKey;
  onSort: (key: SortKey) => void;
}) {
  const th = (children: React.ReactNode) => (
    <th
      scope="col"
      className={cn(
        "px-3 py-2.5 text-left align-middle text-xs font-semibold tracking-wide text-muted-foreground uppercase",
        column.headClassName,
      )}
    >
      {children}
    </th>
  );

  if (!column.asc) {
    return th(column.label);
  }

  const isActive = sort === column.asc || (column.desc && sort === column.desc);
  const isDesc = column.desc && sort === column.desc;
  // Toggle: if currently ascending on this column and a desc key exists, go
  // descending; otherwise (re)apply the ascending key.
  const next: SortKey =
    column.desc && sort === column.asc ? column.desc : column.asc;

  return (
    <th
      scope="col"
      aria-sort={isActive ? (isDesc ? "descending" : "ascending") : "none"}
      className={cn("px-0 align-middle", column.headClassName)}
    >
      <button
        type="button"
        onClick={() => onSort(next)}
        className={cn(
          "inline-flex min-h-9 w-full items-center gap-1 px-3 py-2.5 text-xs font-semibold tracking-wide uppercase outline-none transition-colors focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50",
          column.headClassName?.includes("text-right") ? "justify-end" : "justify-start",
          isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {column.label}
        {isActive ? (
          isDesc ? (
            <ArrowDown className="size-3.5" aria-hidden />
          ) : (
            <ArrowUp className="size-3.5" aria-hidden />
          )
        ) : (
          <ChevronsUpDown className="size-3.5 opacity-60" aria-hidden />
        )}
      </button>
    </th>
  );
}

function TableRow({ item }: { item: ListingItem }) {
  const { product } = item;
  const url = thumbUrl(product);
  const spec = keySpec(product);

  return (
    <tr className="group transition-colors hover:bg-muted/50">
      <td className="px-3 py-2">
        <Link
          href={`/p/${product.slug}`}
          className="block outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-lg"
          tabIndex={-1}
          aria-hidden
        >
          <div className="relative size-10 overflow-hidden rounded-lg bg-muted">
            {url ? (
              <Image src={url} alt="" fill sizes="40px" className="object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                <ImageOff className="size-4" aria-hidden />
              </div>
            )}
          </div>
        </Link>
      </td>
      <td className="max-w-[16rem] px-3 py-2">
        <Link
          href={`/p/${product.slug}`}
          className="block truncate font-medium text-foreground outline-none hover:text-primary focus-visible:text-primary focus-visible:underline"
        >
          {product.name}
        </Link>
      </td>
      <td className="hidden px-3 py-2 font-tabular text-xs text-muted-foreground md:table-cell">
        {product.sku}
      </td>
      <td className="hidden px-3 py-2 text-muted-foreground lg:table-cell">
        {product.brandRef?.name ?? product.brand ?? "—"}
      </td>
      <td className="hidden max-w-[14rem] px-3 py-2 text-xs text-muted-foreground lg:table-cell">
        <span className="block truncate">{spec ?? "—"}</span>
      </td>
      {/* PRICE CELL — gated: the server-built slot is a locked chip unless the
          viewer is approved. No amount is ever rendered here for a gated viewer. */}
      <td className="px-3 py-2 text-right">
        <div className="flex justify-end">{item.priceSlot}</div>
      </td>
      <td className="hidden px-3 py-2 text-right font-tabular text-muted-foreground sm:table-cell">
        {product.moq ?? "—"}
      </td>
      <td className="px-3 py-2">
        <div className="flex justify-end">
          <StatusChip variant={stockChipVariant(product.stockStatus)} />
        </div>
      </td>
    </tr>
  );
}
