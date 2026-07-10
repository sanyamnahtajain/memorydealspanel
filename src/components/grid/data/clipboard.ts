/**
 * Clipboard engine — Excel / Google Sheets compatible TSV copy & paste.
 *
 * Copy: serialize a rectangular selection into tab-separated rows. Paste:
 * parse TSV text back into a 2-D block, then apply it at a target coordinate,
 * mapping the block onto columns *by position* and coercing each cell to the
 * target column's canonical value (currency rupees → integer paise, etc.).
 *
 * Pure & framework-free. `applyPaste` returns the next rows, an undoable
 * {@link GridCommand}, and an `overflow` report so the UI can confirm before
 * extending the grid with new rows.
 *
 * Import types from '@/components/grid/types'.
 */

import type {
  CellChange,
  CellCoord,
  CellRange,
  ColumnDef,
  GridCommand,
  GridRow,
} from "@/components/grid/types";
import { coerceCellValue, stringifyCellValue } from "./coerce";

/* -------------------------------------------------------------------------- */
/*  Range helpers                                                             */
/* -------------------------------------------------------------------------- */

/** A range resolved to concrete row/column index bounds (inclusive). */
export interface ResolvedRange {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function indexById(rows: GridRow[]): Map<string, number> {
  const map = new Map<string, number>();
  rows.forEach((row, i) => map.set(row.id, i));
  return map;
}

function indexByKey(columns: ColumnDef[]): Map<string, number> {
  const map = new Map<string, number>();
  columns.forEach((col, i) => map.set(col.key, i));
  return map;
}

/**
 * Resolve a {@link CellRange} (unordered coords) to inclusive numeric bounds.
 * Returns null when either endpoint references an unknown row or column.
 */
export function resolveRange(
  range: CellRange,
  rows: GridRow[],
  columns: ColumnDef[],
): ResolvedRange | null {
  const rowIx = indexById(rows);
  const colIx = indexByKey(columns);
  const r1 = rowIx.get(range.start.rowId);
  const r2 = rowIx.get(range.end.rowId);
  const c1 = colIx.get(range.start.colKey);
  const c2 = colIx.get(range.end.colKey);
  if (r1 === undefined || r2 === undefined || c1 === undefined || c2 === undefined) {
    return null;
  }
  return {
    top: Math.min(r1, r2),
    bottom: Math.max(r1, r2),
    left: Math.min(c1, c2),
    right: Math.max(c1, c2),
  };
}

/* -------------------------------------------------------------------------- */
/*  Serialize                                                                 */
/* -------------------------------------------------------------------------- */

const TAB = "\t";
const ROW_SEP = "\n";

/**
 * Serialize a rectangular selection into a TSV string that Excel / Sheets can
 * ingest. Cells are joined by tabs, rows by newlines; embedded tabs/newlines
 * within a cell are quoted (spreadsheet-standard: wrap in `"`, double inner
 * quotes). The reverse of {@link parseTSV}.
 */
export function serializeSelectionToTSV<Row extends GridRow>(
  rows: Row[],
  range: CellRange,
  columns: ColumnDef<Row>[],
): string {
  const bounds = resolveRange(range, rows, columns as ColumnDef[]);
  if (!bounds) return "";

  const lines: string[] = [];
  for (let r = bounds.top; r <= bounds.bottom; r++) {
    const row = rows[r];
    const cells: string[] = [];
    for (let c = bounds.left; c <= bounds.right; c++) {
      const col = columns[c];
      const raw = stringifyCellValue(row[col.key], col.type, col as ColumnDef);
      cells.push(escapeCell(raw));
    }
    lines.push(cells.join(TAB));
  }
  return lines.join(ROW_SEP);
}

function escapeCell(value: string): string {
  if (value.includes(TAB) || value.includes("\n") || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/* -------------------------------------------------------------------------- */
/*  Parse                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Parse a clipboard TSV string into a 2-D block of raw cell strings. Handles
 * quoted cells (with embedded tabs, newlines and escaped `""`) exactly like
 * Excel / Sheets. A trailing blank line (common when copying) is dropped.
 */
export function parseTSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  // Normalize CRLF / lone CR to LF so newline handling is uniform.
  const src = text.replace(/\r\n?/g, "\n");

  while (i < src.length) {
    const ch = src[i];

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }

    if (ch === '"' && cell === "") {
      quoted = true;
      i++;
      continue;
    }
    if (ch === TAB) {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
      continue;
    }
    cell += ch;
    i++;
  }

  // Flush the final cell/row (no trailing newline).
  row.push(cell);
  rows.push(row);

  // Drop a single trailing empty row produced by a trailing newline.
  if (rows.length > 1) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === "") rows.pop();
  }

  return rows;
}

/* -------------------------------------------------------------------------- */
/*  Paste                                                                     */
/* -------------------------------------------------------------------------- */

/** Rows that the paste block extends past the current grid, if any. */
export interface PasteOverflow {
  /** Count of block rows that would land below the last existing row. */
  extraRows: number;
}

/** Result of {@link applyPaste}. */
export interface PasteResult<Row extends GridRow> {
  /** Rows after the paste (unchanged when nothing was written). */
  rows: Row[];
  /** Undoable command describing every overwritten cell, or null if none. */
  command: Extract<GridCommand, { kind: "paste-block" }> | null;
  /** Overflow report for the UI to confirm before extending the grid. */
  overflow: PasteOverflow;
  /** Cells skipped because coercion failed, keyed for optional UI surfacing. */
  skipped: Array<{ coord: CellCoord; reason: string }>;
}

/**
 * Apply a pasted `block` at `targetCoord`, mapping block columns onto grid
 * columns by position starting at the target column. Each cell is coerced to
 * the destination column's type (currency rupees → paise); read-only columns
 * and failed coercions are skipped. A single-cell block "stamps" across a
 * multi-cell target only when the caller pre-expands the block — here we honor
 * the block as-is and clip to the right edge of the grid.
 *
 * Rows beyond the current grid are NOT written; their count is reported via
 * `overflow.extraRows` so the UI can confirm extending the grid, then re-issue
 * the paste against a grown row set.
 */
export function applyPaste<Row extends GridRow>(
  rows: Row[],
  targetCoord: CellCoord,
  block: string[][],
  columns: ColumnDef<Row>[],
): PasteResult<Row> {
  const empty: PasteResult<Row> = {
    rows,
    command: null,
    overflow: { extraRows: 0 },
    skipped: [],
  };
  if (block.length === 0) return empty;

  const rowIx = indexById(rows as GridRow[]);
  const colIx = indexByKey(columns as ColumnDef[]);
  const startRow = rowIx.get(targetCoord.rowId);
  const startCol = colIx.get(targetCoord.colKey);
  if (startRow === undefined || startCol === undefined) return empty;

  const changes: CellChange[] = [];
  const skipped: Array<{ coord: CellCoord; reason: string }> = [];
  // Clone lazily: only copy a row when a cell in it actually changes.
  const nextRows = rows.slice();
  const cloned = new Set<number>();

  let extraRows = 0;

  for (let br = 0; br < block.length; br++) {
    const targetR = startRow + br;
    if (targetR >= rows.length) {
      extraRows++;
      continue;
    }
    const blockRow = block[br];
    for (let bc = 0; bc < blockRow.length; bc++) {
      const targetC = startCol + bc;
      if (targetC >= columns.length) break; // clip past the right edge
      const col = columns[targetC];
      if (col.editable === false || col.type === "computed") continue;

      const coord: CellCoord = { rowId: rows[targetR].id, colKey: col.key };
      const result = coerceCellValue(blockRow[bc], col.type, col.options);
      if (!result.ok) {
        skipped.push({ coord, reason: result.reason });
        continue;
      }
      const prev = rows[targetR][col.key];
      if (valuesEqual(prev, result.value)) continue;

      if (!cloned.has(targetR)) {
        nextRows[targetR] = { ...rows[targetR] };
        cloned.add(targetR);
      }
      (nextRows[targetR] as Record<string, unknown>)[col.key] = result.value;
      changes.push({ coord, prev, next: result.value });
    }
  }

  if (changes.length === 0) {
    return { rows, command: null, overflow: { extraRows }, skipped };
  }

  const command: Extract<GridCommand, { kind: "paste-block" }> = {
    kind: "paste-block",
    anchor: targetCoord,
    changes,
  };
  return { rows: nextRows, command, overflow: { extraRows }, skipped };
}

/** Structural equality that treats string[] (multi-tag) by content. */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return false;
}
