"use client";

import * as React from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** A single spec row with a stable key so inputs don't lose focus on edit. */
export interface SpecRow {
  id: string;
  key: string;
  value: string;
}

interface SpecEditorProps {
  rows: SpecRow[];
  onChange: (rows: SpecRow[]) => void;
  className?: string;
  disabled?: boolean;
}

let rowSeq = 0;
/** Fresh client-only row id (module counter — avoids hydration mismatch). */
export function newSpecRow(key = "", value = ""): SpecRow {
  rowSeq += 1;
  return { id: `spec-${rowSeq}`, key, value };
}

/**
 * Converts a stored specs object into ordered editor rows. Used by the form
 * to hydrate an existing product's specs Json.
 */
export function specsToRows(specs: unknown): SpecRow[] {
  if (!specs || typeof specs !== "object" || Array.isArray(specs)) {
    return [];
  }
  return Object.entries(specs as Record<string, unknown>).map(([key, value]) =>
    newSpecRow(key, value == null ? "" : String(value)),
  );
}

/**
 * Collapses editor rows back into a specs object for submission. Rows with a
 * blank key are dropped; later keys win on collision. Returns `undefined` when
 * no valid rows remain, so the field is omitted from the patch.
 */
export function rowsToSpecs(
  rows: SpecRow[],
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    out[key] = row.value.trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Key/value spec editor: a stack of add/removable rows for a product's
 * technical specifications (capacity, interface, warranty, …). Controlled by
 * the parent form via `rows` + `onChange`.
 */
export function SpecEditor({
  rows,
  onChange,
  className,
  disabled,
}: SpecEditorProps) {
  const updateRow = (id: string, patch: Partial<SpecRow>) => {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const removeRow = (id: string) => {
    onChange(rows.filter((row) => row.id !== id));
  };

  const addRow = () => {
    onChange([...rows, newSpecRow()]);
  };

  return (
    <div className={cn("space-y-2", className)}>
      {rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-2">
              <Input
                aria-label="Spec name"
                placeholder="Capacity"
                value={row.key}
                disabled={disabled}
                onChange={(e) => updateRow(row.id, { key: e.target.value })}
                className="flex-1"
              />
              <Input
                aria-label="Spec value"
                placeholder="128 GB"
                value={row.value}
                disabled={disabled}
                onChange={(e) => updateRow(row.id, { value: e.target.value })}
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove spec"
                disabled={disabled}
                onClick={() => removeRow(row.id)}
                className="shrink-0 text-muted-foreground hover:text-destructive"
              >
                <Trash2Icon aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No specifications yet.</p>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={addRow}
      >
        <PlusIcon aria-hidden />
        Add spec
      </Button>
    </div>
  );
}
