"use client";

/**
 * ColumnMapper — step 2 of the import wizard.
 *
 * Presents each canonical import field with a dropdown that selects which of
 * the uploaded file's columns feeds it. Auto-matched fields start pre-selected
 * (from the server's `autoMapColumns`); the user can remap or clear any of
 * them. Required fields with no source header are flagged, and a source header
 * can only feed ONE field at a time (picking it elsewhere frees the old slot).
 */

import * as React from "react";
import { CheckIcon, AlertTriangleIcon } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ColumnMapping, ImportField } from "@/server/services/import";

export interface MapperField {
  key: ImportField;
  label: string;
  required: boolean;
}

export interface ColumnMapperProps {
  /** Source headers from the uploaded file. */
  headers: string[];
  /** Canonical fields to map onto. */
  fields: MapperField[];
  /** Current mapping (field → source header). */
  mapping: ColumnMapping;
  onChange: (mapping: ColumnMapping) => void;
}

/** Sentinel value for "not mapped" (Select cannot use an empty string value). */
const UNMAPPED = "__unmapped__";

export function ColumnMapper({
  headers,
  fields,
  mapping,
  onChange,
}: ColumnMapperProps) {
  const setField = React.useCallback(
    (field: ImportField, header: string | null) => {
      const next: ColumnMapping = { ...mapping };
      if (header === null) {
        delete next[field];
      } else {
        // A source header feeds at most one field: free it from any other slot.
        for (const key of Object.keys(next) as ImportField[]) {
          if (next[key] === header && key !== field) delete next[key];
        }
        next[field] = header;
      }
      onChange(next);
    },
    [mapping, onChange],
  );

  const missingRequired = fields.filter(
    (f) => f.required && !mapping[f.key],
  );

  return (
    <div className="space-y-4">
      {missingRequired.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Map every required field before continuing:{" "}
            <span className="font-medium">
              {missingRequired.map((f) => f.label).join(", ")}
            </span>
            .
          </span>
        </div>
      )}

      <div className="grid gap-2.5 sm:grid-cols-2">
        {fields.map((field) => {
          const selected = mapping[field.key] ?? null;
          const isMissing = field.required && !selected;
          return (
            <div
              key={field.key}
              className={cn(
                "flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5",
                isMissing && "border-amber-500/40",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-foreground">
                    {field.label}
                  </span>
                  {field.required && (
                    <span
                      className="text-destructive"
                      aria-label="required"
                      title="Required"
                    >
                      *
                    </span>
                  )}
                  {selected && (
                    <CheckIcon
                      className="size-3.5 text-emerald-600 dark:text-emerald-400"
                      aria-hidden
                    />
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {selected ? `from "${selected}"` : "not mapped"}
                </p>
              </div>

              <Select
                value={selected ?? UNMAPPED}
                onValueChange={(value) =>
                  setField(field.key, value === UNMAPPED ? null : value)
                }
              >
                <SelectTrigger
                  className="w-[46%] min-w-[9rem]"
                  aria-label={`Source column for ${field.label}`}
                >
                  <SelectValue placeholder="Choose column" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNMAPPED}>— Not mapped —</SelectItem>
                  {headers.map((header) => (
                    <SelectItem key={header} value={header}>
                      {header}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
