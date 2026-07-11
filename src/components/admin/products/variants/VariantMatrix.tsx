"use client";

import * as React from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseRupees } from "@/lib/money";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EntityStatus, StockStatus } from "@/lib/schemas/shared";
import type { EditorVariant, OptionType } from "./types";
import { setDefault, variantLabel } from "./variant-utils";
import { paiseToInput } from "./money-input";

const STOCK_OPTIONS: { value: StockStatus; label: string }[] = [
  { value: "IN_STOCK", label: "In stock" },
  { value: "LOW", label: "Low" },
  { value: "OUT_OF_STOCK", label: "Out of stock" },
];

const STATUS_OPTIONS: { value: EntityStatus; label: string }[] = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Hidden" },
];

interface VariantMatrixProps {
  optionTypes: OptionType[];
  variants: EditorVariant[];
  onChange: (variants: EditorVariant[]) => void;
  /** Per-variant images live on their own page; only usable once saved. */
  onManageImages?: (variant: EditorVariant) => void;
  disabled?: boolean;
}

/**
 * VariantMatrix — the editable grid of every generated variant. One row per
 * combination; per-row editable price (₹→paise), MRP, SKU (auto-suggested,
 * overridable), stock, status, and a custom radio to pick THE default variant.
 * A bulk "set price for all" applies one ₹ amount across every row.
 *
 * All money is entered in ₹ and stored as integer paise on the {@link
 * EditorVariant} rows the parent owns — this component is fully controlled.
 * Per-variant images are managed on a dedicated page (needs a saved id), so the
 * cell shows a count + link rather than an inline uploader.
 */
export function VariantMatrix({
  optionTypes,
  variants,
  onChange,
  onManageImages,
  disabled,
}: VariantMatrixProps) {
  const axisNames = React.useMemo(
    () => optionTypes.map((a) => a.name.trim()).filter(Boolean),
    [optionTypes],
  );

  const [bulkPrice, setBulkPrice] = React.useState("");

  const updateRow = (key: string, patch: Partial<EditorVariant>) => {
    onChange(
      variants.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  };

  const applyBulkPrice = () => {
    const paise = parseRupees(bulkPrice);
    if (paise == null) return;
    onChange(variants.map((row) => ({ ...row, price: paise })));
  };

  const chooseDefault = (key: string) => {
    onChange(setDefault(variants, key));
  };

  if (variants.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
        <p className="font-medium text-foreground">No variants yet</p>
        <p className="mt-1 text-xs">
          Add option axes with values above, then press{" "}
          <span className="font-medium text-foreground">Generate variants</span>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Bulk actions */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/30 p-3">
        <div className="space-y-1.5">
          <Label htmlFor="bulk-price" className="text-xs">
            Set price for all
          </Label>
          <div className="relative">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-muted-foreground"
            >
              ₹
            </span>
            <Input
              id="bulk-price"
              inputMode="decimal"
              value={bulkPrice}
              disabled={disabled}
              onChange={(e) =>
                setBulkPrice(e.target.value.replace(/[^\d.,]/g, ""))
              }
              placeholder="0.00"
              className="w-32 pl-6 font-tabular"
            />
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || parseRupees(bulkPrice) == null}
          onClick={applyBulkPrice}
        >
          Apply to all
        </Button>
        <p className="ml-auto self-center text-xs text-muted-foreground">
          {variants.length} variant{variants.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center">Def.</TableHead>
              {axisNames.map((name) => (
                <TableHead key={name}>{name}</TableHead>
              ))}
              <TableHead className="min-w-[9rem]">SKU</TableHead>
              <TableHead className="w-28">Price</TableHead>
              <TableHead className="w-28">MRP</TableHead>
              <TableHead className="w-32">Stock</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-16 text-center">Photos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {variants.map((row) => (
              <TableRow
                key={row.key}
                className={cn(row.status === "INACTIVE" && "opacity-60")}
              >
                <TableCell className="text-center">
                  <DefaultRadio
                    checked={row.isDefault}
                    disabled={disabled}
                    label={`Make ${variantLabel(row.optionValues)} the default`}
                    onSelect={() => chooseDefault(row.key)}
                  />
                </TableCell>

                {axisNames.map((name) => (
                  <TableCell key={name} className="font-medium text-foreground">
                    {row.optionValues[name] ?? "—"}
                  </TableCell>
                ))}

                <TableCell>
                  <Input
                    aria-label={`SKU for ${variantLabel(row.optionValues)}`}
                    value={row.sku}
                    disabled={disabled}
                    onChange={(e) => updateRow(row.key, { sku: e.target.value })}
                    className="h-8 font-tabular"
                  />
                </TableCell>

                <TableCell>
                  <RupeeCell
                    label={`Price for ${variantLabel(row.optionValues)}`}
                    paise={row.price}
                    disabled={disabled}
                    onChange={(paise) =>
                      updateRow(row.key, { price: paise ?? 0 })
                    }
                  />
                </TableCell>

                <TableCell>
                  <RupeeCell
                    label={`MRP for ${variantLabel(row.optionValues)}`}
                    paise={row.mrp}
                    disabled={disabled}
                    onChange={(paise) => updateRow(row.key, { mrp: paise })}
                  />
                </TableCell>

                <TableCell>
                  <Select
                    value={row.stockStatus}
                    onValueChange={(value) =>
                      updateRow(row.key, { stockStatus: value as StockStatus })
                    }
                    items={STOCK_OPTIONS}
                  >
                    <SelectTrigger
                      aria-label={`Stock for ${variantLabel(row.optionValues)}`}
                      className="h-8 w-full"
                      disabled={disabled}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STOCK_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>

                <TableCell>
                  <Select
                    value={row.status}
                    onValueChange={(value) =>
                      updateRow(row.key, { status: value as EntityStatus })
                    }
                    items={STATUS_OPTIONS}
                  >
                    <SelectTrigger
                      aria-label={`Status for ${variantLabel(row.optionValues)}`}
                      className="h-8 w-full"
                      disabled={disabled}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>

                <TableCell className="text-center">
                  <ImagesCell
                    variant={row}
                    disabled={disabled}
                    onManage={onManageImages}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * A single ₹ cell. Holds its own raw text so partial input ("12.") doesn't get
 * clobbered mid-typing; commits parsed paise to the parent on change. An empty
 * field commits `null` (used for the optional MRP).
 */
function RupeeCell({
  paise,
  onChange,
  label,
  disabled,
}: {
  paise: number | null;
  onChange: (paise: number | null) => void;
  label: string;
  disabled?: boolean;
}) {
  const [text, setText] = React.useState(() => paiseToInput(paise));

  // Re-seed when the value is changed externally (e.g. bulk "set price for all")
  // using React's adjust-on-prop-change pattern keyed by the incoming paise.
  const [lastPaise, setLastPaise] = React.useState(paise);
  if (paise !== lastPaise) {
    setLastPaise(paise);
    setText(paiseToInput(paise));
  }

  const commit = (raw: string) => {
    const cleaned = raw.replace(/[^\d.,]/g, "");
    setText(cleaned);
    if (cleaned.trim() === "") {
      onChange(null);
      return;
    }
    const parsed = parseRupees(cleaned);
    if (parsed != null) onChange(parsed);
  };

  const invalid = text.trim() !== "" && parseRupees(text) == null;

  return (
    <div className="relative">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs text-muted-foreground"
      >
        ₹
      </span>
      <Input
        aria-label={label}
        aria-invalid={invalid || undefined}
        inputMode="decimal"
        value={text}
        disabled={disabled}
        onChange={(e) => commit(e.target.value)}
        placeholder="0.00"
        className="h-8 pl-5 font-tabular"
      />
    </div>
  );
}

/**
 * Custom radio for "this is the default variant". A native radio group would
 * need a shared `name`; here we render an accessible role="radio" button so it
 * matches the design system and one-per-matrix selection is enforced in state.
 */
function DefaultRadio({
  checked,
  onSelect,
  label,
  disabled,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "inline-flex size-4 items-center justify-center rounded-full border transition-fast focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50",
        checked ? "border-primary" : "border-input hover:border-ring",
      )}
    >
      {checked ? (
        <span className="size-2 rounded-full bg-primary" aria-hidden />
      ) : null}
    </button>
  );
}

/**
 * Per-variant photos cell. Persisted variants get a link to their image page
 * (managed elsewhere — needs a real id, same seam as the product's own photos);
 * unsaved rows show a muted "save first" hint.
 */
function ImagesCell({
  variant,
  onManage,
  disabled,
}: {
  variant: EditorVariant;
  onManage?: (variant: EditorVariant) => void;
  disabled?: boolean;
}) {
  if (!variant.id || !onManage) {
    return (
      <span
        className="text-xs text-muted-foreground/70"
        title="Save the product to add per-variant photos"
      >
        —
      </span>
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={disabled}
      aria-label={`Manage photos for ${variantLabel(variant.optionValues)}`}
      onClick={() => onManage(variant)}
    >
      <ImageIcon aria-hidden />
      {variant.imageCount > 0 ? (
        <span className="ml-0.5 text-[0.65rem] tabular-nums">
          {variant.imageCount}
        </span>
      ) : null}
    </Button>
  );
}
