"use client";

import * as React from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { specKeysAction, specValuesAction } from "@/server/actions/suggestions";

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
            <SpecRowFields
              key={row.id}
              row={row}
              disabled={disabled}
              onKeyChange={(key) => updateRow(row.id, { key })}
              onValueChange={(value) => updateRow(row.id, { value })}
              onRemove={() => removeRow(row.id)}
            />
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

/**
 * A single spec row: a KEY combobox and a VALUE combobox.
 *
 * KEY suggests the DISTINCT spec keys already used across the catalog
 * (`specKeysAction`), so "Wattage" / "wattage" / "Watts" collapse onto one
 * canonical spelling instead of fragmenting facets.
 *
 * VALUE is keyed off the chosen key: once a key is set, it suggests the values
 * previously entered *for that key* (`specValuesAction(key)`) — e.g. picking
 * "Interface" offers "USB 3.2", "NVMe", "SATA III". Both allow free entry so a
 * genuinely new spec/value is never blocked.
 *
 * Split into its own component so each row owns a stable `onSearch` closure
 * bound to its current key, without re-deriving fetchers for every row on
 * every parent render.
 */
function SpecRowFields({
  row,
  disabled,
  onKeyChange,
  onValueChange,
  onRemove,
}: {
  row: SpecRow;
  disabled?: boolean;
  onKeyChange: (key: string) => void;
  onValueChange: (value: string) => void;
  onRemove: () => void;
}) {
  const fetchKeys = React.useCallback(async (query: string): Promise<string[]> => {
    try {
      const res = await specKeysAction(query);
      return res.ok ? res.values : [];
    } catch {
      return [];
    }
  }, []);

  // Rebind the value fetcher whenever the key changes so suggestions always
  // reflect the current key. Empty key → no value suggestions yet.
  const key = row.key.trim();
  const fetchValues = React.useCallback(
    async (query: string): Promise<string[]> => {
      if (!key) return [];
      try {
        const res = await specValuesAction(key, query);
        return res.ok ? res.values : [];
      } catch {
        return [];
      }
    },
    [key],
  );

  return (
    <div className="flex items-center gap-2">
      <Combobox
        aria-label="Spec name"
        placeholder="Capacity"
        value={row.key}
        disabled={disabled}
        onValueChange={onKeyChange}
        onSearch={fetchKeys}
        allowCreate
        emptyMessage="New spec — press Enter to add it"
        className="flex-1"
      />
      <Combobox
        aria-label="Spec value"
        placeholder="128 GB"
        value={row.value}
        disabled={disabled}
        onValueChange={onValueChange}
        onSearch={fetchValues}
        allowCreate
        emptyMessage={
          key
            ? "New value — press Enter to add it"
            : "Enter a spec name first"
        }
        className="flex-1"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Remove spec"
        disabled={disabled}
        onClick={onRemove}
        className="shrink-0 text-muted-foreground hover:text-destructive"
      >
        <Trash2Icon aria-hidden />
      </Button>
    </div>
  );
}
