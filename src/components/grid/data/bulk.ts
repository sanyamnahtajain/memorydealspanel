/**
 * Bulk operations engine — apply one mutation across many selected rows.
 *
 * Every operation is pure: it takes the current rows, a set of target row ids,
 * and operation params, and returns the next rows plus a single undoable
 * {@link GridCommand} of kind `"bulk"` (label + every touched cell's
 * prev/next). Currency adjustments go through {@link adjustPaise} so percent
 * and delta math stays in integer PAISE.
 *
 * Import types from '@/components/grid/types'.
 */

import { adjustPaise } from "@/lib/money";
import type {
  CellChange,
  GridCommand,
  GridRow,
} from "@/components/grid/types";

/** Result shared by every bulk operation. */
export interface BulkResult<Row extends GridRow> {
  rows: Row[];
  command: Extract<GridCommand, { kind: "bulk" }> | null;
}

/** Field name marking a soft-deleted row (see {@link softDelete}). */
export const SOFT_DELETE_FIELD = "deletedAt";

type Draft<Row extends GridRow> = {
  nextRows: Row[];
  cloned: Set<number>;
  changes: CellChange[];
  index: Map<string, number>;
};

function beginDraft<Row extends GridRow>(
  rows: Row[],
  rowIds: Iterable<string>,
): { draft: Draft<Row>; targets: number[] } {
  const index = new Map<string, number>();
  rows.forEach((r, i) => index.set(r.id, i));
  const targets: number[] = [];
  for (const id of rowIds) {
    const i = index.get(id);
    if (i !== undefined) targets.push(i);
  }
  return {
    draft: { nextRows: rows.slice(), cloned: new Set(), changes: [], index },
    targets,
  };
}

/** Write one field on one row index, recording the change (no-op if equal). */
function writeCell<Row extends GridRow>(
  draft: Draft<Row>,
  rows: Row[],
  rowIndex: number,
  colKey: string,
  next: unknown,
): void {
  const prev = rows[rowIndex][colKey as keyof Row];
  if (valuesEqual(prev, next)) return;
  if (!draft.cloned.has(rowIndex)) {
    draft.nextRows[rowIndex] = { ...rows[rowIndex] };
    draft.cloned.add(rowIndex);
  }
  (draft.nextRows[rowIndex] as Record<string, unknown>)[colKey] = next;
  draft.changes.push({
    coord: { rowId: rows[rowIndex].id, colKey },
    prev,
    next,
  });
}

function finish<Row extends GridRow>(
  rows: Row[],
  draft: Draft<Row>,
  label: string,
): BulkResult<Row> {
  if (draft.changes.length === 0) return { rows, command: null };
  return {
    rows: draft.nextRows,
    command: { kind: "bulk", label, changes: draft.changes },
  };
}

/* -------------------------------------------------------------------------- */
/*  setField                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Set a single column to a fixed value across every selected row. The value is
 * assumed already coerced to the column's canonical form.
 */
export function setField<Row extends GridRow>(
  rows: Row[],
  rowIds: Iterable<string>,
  colKey: keyof Row & string,
  value: unknown,
): BulkResult<Row> {
  const { draft, targets } = beginDraft(rows, rowIds);
  for (const i of targets) {
    writeCell(draft, rows, i, colKey, value);
  }
  return finish(rows, draft, `Set ${colKey}`);
}

/* -------------------------------------------------------------------------- */
/*  adjustCurrency                                                            */
/* -------------------------------------------------------------------------- */

/** Params for {@link adjustCurrency}: percent applied first, then delta paise. */
export interface AdjustCurrencyParams {
  /** Percentage change, e.g. 5 → +5%, -2.5 → -2.5%. Applied first. */
  percent?: number;
  /** Absolute change in integer paise, applied after `percent`. */
  delta?: number;
  /** Never let a result drop below this floor (integer paise). Default 0. */
  minPaise?: number;
}

/**
 * Adjust a currency (paise) column across selected rows by a percent and/or a
 * paise delta via {@link adjustPaise}. Non-numeric or missing cells are
 * skipped. Results that would go negative are clamped to `minPaise` (default 0)
 * so a bulk discount can't produce an invalid amount.
 */
export function adjustCurrency<Row extends GridRow>(
  rows: Row[],
  rowIds: Iterable<string>,
  colKey: keyof Row & string,
  params: AdjustCurrencyParams,
): BulkResult<Row> {
  const { percent = 0, delta = 0, minPaise = 0 } = params;
  const { draft, targets } = beginDraft(rows, rowIds);
  for (const i of targets) {
    const current = rows[i][colKey];
    if (typeof current !== "number" || !Number.isSafeInteger(current)) continue;
    let next: number;
    try {
      next = adjustPaise(current, { percent, delta });
    } catch {
      // adjustPaise throws on negatives; clamp to the floor instead of skipping
      // so the whole bulk op stays predictable.
      next = Math.max(minPaise, computeRawAdjust(current, percent, delta));
    }
    if (next < minPaise) next = minPaise;
    writeCell(draft, rows, i, colKey, next);
  }
  const label = describeAdjust(percent, delta);
  return finish(rows, draft, label);
}

/** Mirror of adjustPaise math without the non-negative assertion. */
function computeRawAdjust(paise: number, percent: number, delta: number): number {
  return Math.round(paise * (1 + percent / 100)) + delta;
}

function describeAdjust(percent: number, delta: number): string {
  const parts: string[] = [];
  if (percent) parts.push(`${percent > 0 ? "+" : ""}${percent}%`);
  if (delta) parts.push(`${delta > 0 ? "+" : ""}${delta}p`);
  return `Adjust price ${parts.join(" ") || "0"}`;
}

/* -------------------------------------------------------------------------- */
/*  addTag                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Add a tag to a `multi-tag` column across selected rows, de-duplicating.
 * Missing/non-array cells are treated as an empty tag list.
 */
export function addTag<Row extends GridRow>(
  rows: Row[],
  rowIds: Iterable<string>,
  colKey: keyof Row & string,
  tag: string,
): BulkResult<Row> {
  const { draft, targets } = beginDraft(rows, rowIds);
  for (const i of targets) {
    const current = rows[i][colKey];
    const list = Array.isArray(current) ? (current as string[]) : [];
    if (list.includes(tag)) continue;
    writeCell(draft, rows, i, colKey, [...list, tag]);
  }
  return finish(rows, draft, `Add tag "${tag}"`);
}

/**
 * Remove a tag from a `multi-tag` column across selected rows. Rows lacking the
 * tag are untouched.
 */
export function removeTag<Row extends GridRow>(
  rows: Row[],
  rowIds: Iterable<string>,
  colKey: keyof Row & string,
  tag: string,
): BulkResult<Row> {
  const { draft, targets } = beginDraft(rows, rowIds);
  for (const i of targets) {
    const current = rows[i][colKey];
    if (!Array.isArray(current)) continue;
    const list = current as string[];
    if (!list.includes(tag)) continue;
    writeCell(
      draft,
      rows,
      i,
      colKey,
      list.filter((t) => t !== tag),
    );
  }
  return finish(rows, draft, `Remove tag "${tag}"`);
}

/* -------------------------------------------------------------------------- */
/*  setStatus                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Set a status/`select` column to a fixed value across selected rows. Thin
 * wrapper over {@link setField} with a status-flavored label.
 */
export function setStatus<Row extends GridRow>(
  rows: Row[],
  rowIds: Iterable<string>,
  colKey: keyof Row & string,
  status: string,
): BulkResult<Row> {
  const { draft, targets } = beginDraft(rows, rowIds);
  for (const i of targets) {
    writeCell(draft, rows, i, colKey, status);
  }
  return finish(rows, draft, `Set status "${status}"`);
}

/* -------------------------------------------------------------------------- */
/*  softDelete                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Soft-delete selected rows by stamping {@link SOFT_DELETE_FIELD} with an ISO
 * timestamp (rows are retained so the delete is undoable). Already-deleted rows
 * are skipped. Pass `at` to make the timestamp deterministic (tests).
 */
export function softDelete<Row extends GridRow>(
  rows: Row[],
  rowIds: Iterable<string>,
  at: string = new Date().toISOString(),
): BulkResult<Row> {
  const { draft, targets } = beginDraft(rows, rowIds);
  for (const i of targets) {
    if (rows[i][SOFT_DELETE_FIELD as keyof Row]) continue;
    writeCell(draft, rows, i, SOFT_DELETE_FIELD, at);
  }
  return finish(rows, draft, `Delete ${draft.changes.length || targets.length} rows`);
}

/**
 * Restore soft-deleted rows by clearing {@link SOFT_DELETE_FIELD}. The inverse
 * of {@link softDelete}.
 */
export function restore<Row extends GridRow>(
  rows: Row[],
  rowIds: Iterable<string>,
): BulkResult<Row> {
  const { draft, targets } = beginDraft(rows, rowIds);
  for (const i of targets) {
    if (!rows[i][SOFT_DELETE_FIELD as keyof Row]) continue;
    writeCell(draft, rows, i, SOFT_DELETE_FIELD, null);
  }
  return finish(rows, draft, "Restore rows");
}

/* -------------------------------------------------------------------------- */
/*  shared                                                                    */
/* -------------------------------------------------------------------------- */

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return false;
}
