import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A single, normalised spec row: a human label and its stringified value.
 */
interface SpecRow {
  label: string;
  value: string;
}

/**
 * Normalises the loosely-typed `specs` JSON on a product into an ordered list
 * of printable rows. The seed shape is a flat `{ key: value }` object, but we
 * defensively handle nested/array values and skip empties so a malformed row
 * can never blow up the render.
 */
function normaliseSpecs(specs: unknown): SpecRow[] {
  if (specs === null || specs === undefined) {
    return [];
  }
  if (typeof specs !== "object" || Array.isArray(specs)) {
    return [];
  }

  const rows: SpecRow[] = [];
  for (const [label, raw] of Object.entries(specs as Record<string, unknown>)) {
    const value = stringifyValue(raw);
    if (value.length === 0) {
      continue;
    }
    rows.push({ label, value });
  }
  return rows;
}

function stringifyValue(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return "";
  }
  if (typeof raw === "string") {
    return raw.trim();
  }
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw);
  }
  if (Array.isArray(raw)) {
    return raw
      .map((item) => stringifyValue(item))
      .filter((item) => item.length > 0)
      .join(", ");
  }
  return "";
}

export interface SpecTableProps {
  /** The product's `specs` JSON (see PublicProduct.specs). */
  specs: unknown;
  className?: string;
}

/**
 * A clean two-column specification table. Server component — it renders no
 * pricing and takes no viewer. Returns `null` when there are no printable
 * specs so callers don't have to guard.
 */
export function SpecTable({ specs, className }: SpecTableProps) {
  const rows = normaliseSpecs(specs);
  if (rows.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card",
        className,
      )}
    >
      <dl className="divide-y divide-border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)] gap-4 px-4 py-3 sm:px-5"
          >
            <dt className="text-sm font-medium text-muted-foreground">
              {row.label}
            </dt>
            <dd className="text-sm font-medium text-foreground break-words">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
