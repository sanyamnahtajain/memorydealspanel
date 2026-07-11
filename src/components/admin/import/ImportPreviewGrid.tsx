"use client";

/**
 * ImportPreviewGrid — step 3 of the import wizard.
 *
 * Reuses the generic DealSheet engine in a "review" mode: every preview row is
 * projected to a flat grid row whose cells are editable-in-place so the user
 * can fix problems BEFORE committing. Per-cell validation runs through each
 * column's `validate` (fed by the server-computed error map), an error-only
 * filter toggle narrows the sheet to problem rows, and a pinned operation
 * column badges each row as Create / Update / Invalid.
 *
 * Edits are held locally (there is nothing to persist yet — commit happens in
 * step 4), and every edit re-runs validation via the parent's `onEditRow` so
 * the create/update/invalid classification and error highlighting stay live.
 */

import * as React from "react";

import { DealSheet, MobileCardEditor, type ColumnDef } from "@/components/grid";
import { useIsMobile } from "@/components/common/use-is-mobile";
import { Button } from "@/components/ui/button";
import { formatPaise, parseRupees } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  IMPORT_COLUMNS,
  type ImportField,
  type PreviewRow,
} from "@/server/services/import";

/* -------------------------------------------------------------------------- */
/*  Row model                                                                 */
/* -------------------------------------------------------------------------- */

/** Flat grid row: one string cell per import field, plus meta. */
interface ReviewRow {
  id: string;
  rowNumber: number;
  operation: PreviewRow["operation"];
  /** field → server error message (empty when the cell is clean). */
  errorMap: Partial<Record<ImportField, string>>;
  name: string;
  sku: string;
  brand: string;
  category: string;
  price: string;
  mrp: string;
  moq: string;
  stock: string;
  status: string;
  tags: string;
  description: string;
  hsnCode: string;
  gstRate: string;
  taxInclusive: string;
  /** Parent SKU when this is a variant row (empty otherwise). */
  variantOf: string;
  /** Human-readable option combination, e.g. "Capacity: 16GB · Color: Black". */
  options: string;
  [key: string]: unknown;
}

export interface ImportPreviewGridProps {
  rows: PreviewRow[];
  /**
   * Called when the user edits a cell. The parent re-validates against the
   * live catalog and swaps in a fresh `PreviewRow[]`. Receives the source row
   * number and the patched raw field values.
   */
  onEditRow: (rowNumber: number, patch: Partial<Record<ImportField, string>>) => void;
}

/* -------------------------------------------------------------------------- */
/*  PreviewRow ⇆ ReviewRow                                                     */
/* -------------------------------------------------------------------------- */

function toReviewRow(row: PreviewRow): ReviewRow {
  const errorMap: Partial<Record<ImportField, string>> = {};
  for (const e of row.errors) {
    // Keep the first error per field for the cell tooltip.
    if (!errorMap[e.field]) errorMap[e.field] = e.message;
  }
  const options = row.variant
    ? Object.entries(row.variant.optionValues)
        .map(([axis, value]) => `${axis}: ${value}`)
        .join(" · ")
    : "";
  return {
    id: row.id,
    rowNumber: row.rowNumber,
    operation: row.operation,
    errorMap,
    name: row.raw.name,
    sku: row.raw.sku,
    brand: row.raw.brand,
    category: row.raw.category,
    price: row.raw.price,
    mrp: row.raw.mrp,
    moq: row.raw.moq,
    stock: row.raw.stock,
    status: row.raw.status,
    tags: row.raw.tags,
    description: row.raw.description,
    hsnCode: row.raw.hsnCode,
    gstRate: row.raw.gstRate,
    taxInclusive: row.raw.taxInclusive,
    variantOf: row.variant?.parentSku ?? "",
    options,
  };
}

const OPERATION_META: Record<
  PreviewRow["operation"],
  { label: string; className: string }
> = {
  create: {
    label: "New",
    className: "bg-success/12 text-success",
  },
  update: {
    label: "Update",
    className: "bg-primary/12 text-primary",
  },
  variant: {
    label: "Variant",
    className: "bg-accent/40 text-accent-foreground",
  },
  invalid: {
    label: "Error",
    className: "bg-destructive/12 text-destructive",
  },
};

/* -------------------------------------------------------------------------- */
/*  Columns                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Builds the column config. Each editable column's `validate` first surfaces
 * the server-computed error for that cell (so the red corner + tooltip match
 * the authoritative validation), then falls back to a light client-side format
 * check for immediate feedback while typing.
 */
function buildColumns(): ColumnDef<ReviewRow>[] {
  const serverError =
    (field: ImportField) =>
    (_value: unknown, row: ReviewRow): string | null =>
      row.errorMap[field] ?? null;

  const currencyValidate =
    (field: ImportField) =>
    (value: unknown, row: ReviewRow): string | null => {
      const server = row.errorMap[field];
      if (server) return server;
      const text = String(value ?? "").trim();
      if (text === "") return field === "price" ? "Price is required." : null;
      return parseRupees(text) === null ? "Not a valid amount." : null;
    };

  return [
    {
      key: "operation",
      header: "Op",
      type: "computed",
      width: 84,
      pinned: "left",
      compute: (row) => OPERATION_META[row.operation].label,
    },
    {
      key: "name",
      header: "Name",
      type: "text",
      width: 220,
      pinned: "left",
      validate: serverError("name"),
    },
    { key: "sku", header: "SKU", type: "text", width: 140, validate: serverError("sku") },
    {
      // Read-only: the parent SKU that ties a variant row to its group. Blank
      // for single-product rows. Errors on the parent surface here.
      key: "variantOf",
      header: "Variant of",
      type: "text",
      width: 130,
      validate: serverError("variantOf"),
    },
    {
      // Read-only display of the row's option combination (Capacity: 16GB · …).
      key: "options",
      header: "Options",
      type: "computed",
      width: 200,
      compute: (row) => row.options,
    },
    { key: "brand", header: "Brand", type: "text", width: 130 },
    {
      key: "category",
      header: "Category",
      type: "text",
      width: 150,
      validate: serverError("category"),
    },
    {
      key: "price",
      header: "Price",
      type: "text",
      width: 120,
      validate: currencyValidate("price"),
      format: (v) => formatRupeeCell(v),
    },
    {
      key: "mrp",
      header: "MRP",
      type: "text",
      width: 120,
      validate: currencyValidate("mrp"),
      format: (v) => formatRupeeCell(v),
    },
    { key: "moq", header: "MOQ", type: "text", width: 90, validate: serverError("moq") },
    { key: "stock", header: "Stock", type: "text", width: 130, validate: serverError("stock") },
    { key: "status", header: "Status", type: "text", width: 120, validate: serverError("status") },
    { key: "tags", header: "Tags", type: "text", width: 180 },
    { key: "description", header: "Description", type: "text", width: 240 },
    { key: "hsnCode", header: "HSN", type: "text", width: 110, validate: serverError("hsnCode") },
    { key: "gstRate", header: "GST %", type: "text", width: 90, validate: serverError("gstRate") },
    {
      key: "taxInclusive",
      header: "Tax incl.",
      type: "text",
      width: 100,
      validate: serverError("taxInclusive"),
    },
  ];
}

/** Renders a rupee cell as "₹x" when it parses, else the raw text. */
function formatRupeeCell(value: unknown): string {
  const text = String(value ?? "").trim();
  if (text === "") return "";
  const paise = parseRupees(text);
  return paise === null ? text : formatPaise(paise);
}

/** Fields in the same order used when reading edits back out of the grid. */
const EDITABLE_FIELDS: ImportField[] = IMPORT_COLUMNS.map((c) => c.key);

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function ImportPreviewGrid({ rows, onEditRow }: ImportPreviewGridProps) {
  const isMobile = useIsMobile();
  const [errorsOnly, setErrorsOnly] = React.useState(false);

  const byRowNumber = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.id, r.rowNumber);
    return map;
  }, [rows]);

  const reviewRows = React.useMemo(() => {
    const projected = rows.map(toReviewRow);
    return errorsOnly
      ? projected.filter((r) => r.operation === "invalid")
      : projected;
  }, [rows, errorsOnly]);

  const columns = React.useMemo(() => buildColumns(), []);

  const counts = React.useMemo(() => {
    let creates = 0;
    let updates = 0;
    let invalid = 0;
    let variants = 0;
    const variantParents = new Set<string>();
    for (const r of rows) {
      if (r.operation === "create") creates++;
      else if (r.operation === "update") updates++;
      else if (r.operation === "variant") {
        variants++;
        if (r.variant?.parentSku) variantParents.add(r.variant.parentSku.toLowerCase());
      } else invalid++;
    }
    return {
      creates,
      updates,
      invalid,
      variants,
      variantProducts: variantParents.size,
      total: rows.length,
    };
  }, [rows]);

  const onSave = React.useCallback(
    async (rowId: string, patch: Partial<ReviewRow>) => {
      const rowNumber = byRowNumber.get(rowId);
      if (rowNumber === undefined) return;
      const fieldPatch: Partial<Record<ImportField, string>> = {};
      for (const field of EDITABLE_FIELDS) {
        if (field in patch) {
          fieldPatch[field] = String(patch[field] ?? "");
        }
      }
      if (Object.keys(fieldPatch).length > 0) {
        onEditRow(rowNumber, fieldPatch);
      }
    },
    [byRowNumber, onEditRow],
  );

  const gridProps = {
    gridId: "import-preview",
    rows: reviewRows,
    columns,
    onSave,
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <CountBadge tone="emerald" label="New" value={counts.creates} />
          <CountBadge tone="sky" label="Update" value={counts.updates} />
          {counts.variants > 0 && (
            <CountBadge
              tone="violet"
              label={`Variant${counts.variants === 1 ? "" : "s"} in ${counts.variantProducts} product${counts.variantProducts === 1 ? "" : "s"}`}
              value={counts.variants}
            />
          )}
          <CountBadge tone="destructive" label="Errors" value={counts.invalid} />
          <span className="text-muted-foreground">
            {counts.total} row{counts.total === 1 ? "" : "s"}
          </span>
        </div>
        <Button
          type="button"
          variant={errorsOnly ? "default" : "outline"}
          size="sm"
          className="ml-auto"
          onClick={() => setErrorsOnly((v) => !v)}
          disabled={counts.invalid === 0 && !errorsOnly}
        >
          {errorsOnly ? "Show all rows" : `Show errors only (${counts.invalid})`}
        </Button>
      </div>

      {reviewRows.length === 0 ? (
        <p className="rounded-lg border border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
          {errorsOnly ? "No rows with errors." : "No rows to preview."}
        </p>
      ) : (
        <div className="h-[min(60vh,540px)] min-h-[280px] overflow-hidden rounded-xl border border-border">
          {isMobile ? (
            <MobileCardEditor {...gridProps} />
          ) : (
            <DealSheet {...gridProps} />
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Cells with a red corner have errors — hover to see why. Edit any cell to
        fix it before committing; rows with errors are skipped automatically.
        {counts.variants > 0 && (
          <>
            {" "}
            Rows sharing a <span className="font-medium">Variant of</span> value
            become one product; a variant product commits only when all of its
            rows are error-free.
          </>
        )}
      </p>
    </div>
  );
}

function CountBadge({
  tone,
  label,
  value,
}: {
  tone: "emerald" | "sky" | "violet" | "destructive";
  label: string;
  value: number;
}) {
  const toneClass =
    tone === "emerald"
      ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
      : tone === "sky"
        ? "bg-sky-500/12 text-sky-600 dark:text-sky-400"
        : tone === "violet"
          ? "bg-violet-500/12 text-violet-600 dark:text-violet-400"
          : "bg-destructive/12 text-destructive";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium tabular-nums",
        toneClass,
      )}
    >
      {value}
      <span className="font-normal opacity-80">{label}</span>
    </span>
  );
}
