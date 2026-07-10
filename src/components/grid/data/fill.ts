/**
 * Fill engine — "fill down" and smart arithmetic series, Excel/Sheets style.
 *
 * Two spreadsheet gestures are modeled:
 *
 * - {@link fillDown} (Ctrl+D): the TOP row of the range is the seed; every row
 *   below is overwritten with the seed value, per column. Deterministic and
 *   unambiguous — used when the user has one seed row and wants it repeated.
 *
 * - {@link fillSeries} (drag-fill of a 2+ row selection): the ENTIRE selection
 *   seeds a detected arithmetic series which is then re-projected across the
 *   selection, cleaning up e.g. 100,110,0,0 into 100,110,120,130. Non-numeric
 *   columns fall back to repeating the top value.
 *
 * Currency operates on integer PAISE, so a series of ₹100, ₹110 continues in
 * paise (10000, 11000, 12000…). Pure & framework-free; each returns the next
 * rows plus an undoable {@link GridCommand} of kind `"fill"`.
 *
 * Import types from '@/components/grid/types'.
 */

import type {
  CellChange,
  CellRange,
  ColumnDef,
  GridCommand,
  GridRow,
} from "@/components/grid/types";
import { isNumericType } from "./coerce";
import { resolveRange, type ResolvedRange } from "./clipboard";

/** Result of a fill operation. */
export interface FillResult<Row extends GridRow> {
  rows: Row[];
  command: Extract<GridCommand, { kind: "fill" }> | null;
}

/**
 * Continue a numeric series. Given the seed `values` (in order), return the
 * `count` next values that follow it.
 *
 * - 0 seed values → zeros.
 * - 1 seed value → repeat it.
 * - 2+ values with a constant delta → arithmetic progression (+step).
 * - otherwise (non-uniform) → repeat the last value.
 *
 * Values are numbers in their canonical unit; for currency that unit is paise,
 * so `smartSeries([10000, 11000], 2)` → `[12000, 13000]`.
 */
export function smartSeries(values: number[], count: number): number[] {
  if (count <= 0) return [];
  if (values.length === 0) return new Array(count).fill(0);

  const last = values[values.length - 1];
  if (values.length === 1) return new Array(count).fill(last);

  const step = detectStep(values);
  if (step === null) return new Array(count).fill(last);

  const out: number[] = [];
  for (let i = 1; i <= count; i++) out.push(last + step * i);
  return out;
}

/** Detect a constant arithmetic step; null when differences aren't uniform. */
function detectStep(values: number[]): number | null {
  const first = values[1] - values[0];
  const EPS = 1e-9;
  for (let i = 2; i < values.length; i++) {
    if (Math.abs(values[i] - values[i - 1] - first) > EPS) return null;
  }
  return first;
}

/* -------------------------------------------------------------------------- */
/*  fillDown — repeat the top row (Ctrl+D)                                    */
/* -------------------------------------------------------------------------- */

/**
 * Fill the range downward by repeating each column's TOP (seed) row value into
 * every row below it. The seed row itself is left untouched. This is the
 * deterministic Ctrl+D gesture — for series continuation use {@link fillSeries}.
 */
export function fillDown<Row extends GridRow>(
  rows: Row[],
  range: CellRange,
  columns: ColumnDef<Row>[],
): FillResult<Row> {
  const bounds = resolveRange(range, rows as GridRow[], columns as ColumnDef[]);
  if (!bounds || bounds.bottom === bounds.top) return { rows, command: null };

  return writeFill(rows, range, bounds, columns, (col) => {
    const seed = cloneValue(rows[bounds.top][col.key]);
    const height = bounds.bottom - bounds.top + 1;
    const out: unknown[] = new Array(height).fill(SKIP);
    for (let i = 1; i < height; i++) out[i] = cloneValue(seed);
    return out;
  });
}

/* -------------------------------------------------------------------------- */
/*  fillSeries — detect + project an arithmetic series                        */
/* -------------------------------------------------------------------------- */

/**
 * Fill the range as a smart series. For numeric columns the whole selection is
 * used to detect an arithmetic step (from its leading non-degenerate values),
 * which is then projected across every row of the selection. Non-numeric
 * columns repeat their top value (same as {@link fillDown}).
 */
export function fillSeries<Row extends GridRow>(
  rows: Row[],
  range: CellRange,
  columns: ColumnDef<Row>[],
): FillResult<Row> {
  const bounds = resolveRange(range, rows as GridRow[], columns as ColumnDef[]);
  if (!bounds || bounds.bottom === bounds.top) return { rows, command: null };
  const height = bounds.bottom - bounds.top + 1;

  return writeFill(rows, range, bounds, columns, (col) => {
    const out: unknown[] = new Array(height).fill(SKIP);
    if (isNumericType(col.type)) {
      const seed = leadingNumericSeed(rows, bounds, col);
      if (seed.length >= 1) {
        const fillCount = height - seed.length;
        const series = smartSeries(seed, Math.max(0, fillCount));
        for (let i = 0; i < fillCount; i++) {
          out[seed.length + i] = normalizeNumeric(col, series[i]);
        }
        return out;
      }
    }
    // Non-numeric (or no numeric seed): repeat the top value below it.
    const repeat = rows[bounds.top][col.key];
    for (let i = 1; i < height; i++) out[i] = cloneValue(repeat);
    return out;
  });
}

/**
 * The leading run of numeric cells (up to 2) from the top of the selection that
 * seeds the series. Two cells establish a step; one falls back to repeat.
 */
function leadingNumericSeed<Row extends GridRow>(
  rows: Row[],
  bounds: ResolvedRange,
  col: ColumnDef<Row>,
): number[] {
  const seed: number[] = [];
  const max = Math.min(2, bounds.bottom - bounds.top + 1);
  for (let i = 0; i < max; i++) {
    const v = rows[bounds.top + i][col.key];
    if (typeof v !== "number") break;
    seed.push(v);
  }
  return seed;
}

/* -------------------------------------------------------------------------- */
/*  shared writer                                                             */
/* -------------------------------------------------------------------------- */

/** Sentinel: a target cell that must be left untouched. */
const SKIP = Symbol("skip");

/**
 * Apply a per-column target-value producer over the resolved range, cloning
 * rows lazily and collecting a `fill` command. `produce(col)` returns an array
 * of length = range height where index 0 is the seed row; `SKIP` leaves a cell.
 */
function writeFill<Row extends GridRow>(
  rows: Row[],
  range: CellRange,
  bounds: ResolvedRange,
  columns: ColumnDef<Row>[],
  produce: (col: ColumnDef<Row>) => unknown[],
): FillResult<Row> {
  const height = bounds.bottom - bounds.top + 1;
  const changes: CellChange[] = [];
  const nextRows = rows.slice();
  const cloned = new Set<number>();

  for (let c = bounds.left; c <= bounds.right; c++) {
    const col = columns[c];
    if (col.editable === false || col.type === "computed") continue;
    const targets = produce(col);
    for (let offset = 0; offset < height; offset++) {
      const next = targets[offset];
      if (next === SKIP) continue;
      const r = bounds.top + offset;
      const prev = rows[r][col.key];
      if (valuesEqual(prev, next)) continue;
      if (!cloned.has(r)) {
        nextRows[r] = { ...rows[r] };
        cloned.add(r);
      }
      (nextRows[r] as Record<string, unknown>)[col.key] = next;
      changes.push({ coord: { rowId: rows[r].id, colKey: col.key }, prev, next });
    }
  }

  if (changes.length === 0) return { rows, command: null };

  const command: Extract<GridCommand, { kind: "fill" }> = {
    kind: "fill",
    source: {
      start: { rowId: rows[bounds.top].id, colKey: columns[bounds.left].key },
      end: { rowId: rows[bounds.top].id, colKey: columns[bounds.right].key },
    },
    target: range,
    changes,
  };
  return { rows: nextRows, command };
}

function normalizeNumeric<Row extends GridRow>(
  col: ColumnDef<Row>,
  value: number,
): number {
  // Paise are integers; guard the series against float drift.
  return col.type === "currency" ? Math.round(value) : value;
}

function cloneValue(value: unknown): unknown {
  return Array.isArray(value) ? value.slice() : value;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return false;
}
