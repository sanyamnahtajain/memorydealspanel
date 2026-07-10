/**
 * DealSheet grid — shared TYPE CONTRACT.
 *
 * This module is the single source of truth for the grid's public types.
 * It is intentionally (almost) runtime-free: pure types plus a handful of
 * tiny type guards. The grid engine is GENERIC and DECOUPLED from any domain
 * model ("product", "deal", …) — it operates on a generic `Row extends GridRow`
 * with an injected `ColumnDef<Row>[]` config and an injected `OnSave<Row>`.
 *
 * Import from '@/components/grid/types'.
 */

/* -------------------------------------------------------------------------- */
/*  Cell types                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The kind of editor / renderer a column uses.
 * - `text`       free-form string
 * - `number`     plain numeric value
 * - `currency`   integer PAISE (see src/lib/money.ts) — never floats/rupees
 * - `percent`    percentage value (0–100)
 * - `select`     single choice from `options`
 * - `multi-tag`  many choices from `options`, stored as string[]
 * - `toggle`     boolean
 * - `image`      image URL / asset reference
 * - `computed`   derived, read-only value produced by `compute`
 */
export type CellType =
  | "text"
  | "number"
  | "currency"
  | "percent"
  | "select"
  | "multi-tag"
  | "toggle"
  | "image"
  | "computed";

/** The set of cell types that are inherently read-only. */
export const READONLY_CELL_TYPES = ["computed"] as const;

/* -------------------------------------------------------------------------- */
/*  Rows                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Minimal shape every grid row must satisfy: a stable string `id` plus an
 * open bag of unknown-typed fields. Concrete callers narrow this with their
 * own interface (e.g. `interface ProductRow extends GridRow { … }`).
 */
export type GridRow = { id: string } & Record<string, unknown>;

/* -------------------------------------------------------------------------- */
/*  Column definitions                                                        */
/* -------------------------------------------------------------------------- */

/** A single choice for `select` / `multi-tag` columns. */
export interface CellOption {
  value: string;
  label: string;
  /** Optional token/hex used to color the chip. */
  color?: string;
}

/**
 * Declarative description of one column. The engine reads this to render,
 * edit, validate, compute, and format cells — it hardcodes no domain fields.
 *
 * @typeParam Row - the concrete row type this column belongs to.
 */
export interface ColumnDef<Row extends GridRow = GridRow> {
  /** Property key on `Row` this column reads/writes. Must be a string key. */
  key: keyof Row & string;
  /** Human-readable column header. */
  header: string;
  /** How the cell is rendered and edited. */
  type: CellType;
  /** Fixed pixel width; the engine picks a sensible default when omitted. */
  width?: number;
  /** Whether the cell can be edited. Defaults to true except `computed`. */
  editable?: boolean;
  /** Pin the column to the left edge (frozen while scrolling). */
  pinned?: "left";
  /** Choices for `select` / `multi-tag` columns. */
  options?: CellOption[];
  /**
   * Validate a candidate value for this column.
   * @returns an error message string, or `null` when valid.
   */
  validate?: (value: unknown, row: Row) => string | null;
  /** Derive the value for `computed` columns from the whole row. */
  compute?: (row: Row) => number | string;
  /** Format a stored value into display text (e.g. paise → "₹499.50"). */
  format?: (value: unknown) => string;
}

/* -------------------------------------------------------------------------- */
/*  Coordinates & selection                                                   */
/* -------------------------------------------------------------------------- */

/** Address of a single cell: which row, which column. */
export interface CellCoord {
  rowId: string;
  colKey: string;
}

/** A rectangular selection spanning `start` → `end` (inclusive, unordered). */
export interface CellRange {
  start: CellCoord;
  end: CellCoord;
}

/* -------------------------------------------------------------------------- */
/*  Save lifecycle                                                            */
/* -------------------------------------------------------------------------- */

/** Per-row persistence status. */
export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** Tracked save state for one row. */
export interface RowSaveState {
  status: SaveStatus;
  /** Present only when `status === 'error'`. */
  error?: string;
}

/**
 * Injected persistence callback. Receives the row id and a partial patch of
 * changed fields; resolves on success, rejects on failure (the engine surfaces
 * the rejection as a `RowSaveState` error).
 */
export type OnSave<Row extends GridRow = GridRow> = (
  rowId: string,
  patch: Partial<Row>,
) => Promise<void>;

/* -------------------------------------------------------------------------- */
/*  Undo / redo commands                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A change to a single cell, carrying both the previous and next value so it
 * can be applied forward (redo) or inverted (undo).
 */
export interface CellChange {
  coord: CellCoord;
  prev: unknown;
  next: unknown;
}

/**
 * Discriminated union of undoable grid mutations. Every variant carries enough
 * data (`changes`, each with `prev`/`next`) to invert itself, so undo/redo is
 * a matter of swapping `prev`⇄`next` and re-applying.
 */
export type GridCommand =
  | {
      kind: "cell-edit";
      /** Exactly one changed cell. */
      change: CellChange;
    }
  | {
      kind: "paste-block";
      /** Anchor where the paste began (top-left of the pasted block). */
      anchor: CellCoord;
      /** Every cell the paste overwrote, with prior + pasted values. */
      changes: CellChange[];
    }
  | {
      kind: "fill";
      /** The source range that seeded the fill. */
      source: CellRange;
      /** The range the fill wrote into. */
      target: CellRange;
      /** Every cell the fill overwrote, with prior + filled values. */
      changes: CellChange[];
    }
  | {
      kind: "bulk";
      /** Human-readable label for the batched operation (for UI / history). */
      label: string;
      /** Every cell touched by the bulk operation. */
      changes: CellChange[];
    };

/** All `GridCommand.kind` discriminants. */
export type GridCommandKind = GridCommand["kind"];

/* -------------------------------------------------------------------------- */
/*  Saved views                                                               */
/* -------------------------------------------------------------------------- */

/** Sort directive for a single column. */
export interface SortSpec {
  colKey: string;
  dir: "asc" | "desc";
}

/**
 * A persisted view: filter/sort/visibility/order configuration the user can
 * name and switch between.
 */
export interface SavedView {
  id: string;
  name: string;
  /** Column key → filter query string. */
  filters: Record<string, string>;
  /** Ordered list of sort directives (primary first). */
  sort: SortSpec[];
  /** Column keys hidden from view. */
  hidden: string[];
  /** Column keys in display order. */
  columnOrder: string[];
}

/* -------------------------------------------------------------------------- */
/*  Tiny type guards                                                          */
/* -------------------------------------------------------------------------- */

/** True when `value` is a `GridRow` (object with a string `id`). */
export function isGridRow(value: unknown): value is GridRow {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

/** True when the given cell type is inherently read-only. */
export function isReadonlyCellType(type: CellType): boolean {
  return (READONLY_CELL_TYPES as readonly CellType[]).includes(type);
}

/**
 * Resolve whether a column is editable, honoring the `computed`/read-only rule:
 * an explicit `editable` flag wins, otherwise everything but read-only types is
 * editable by default.
 */
export function isColumnEditable<Row extends GridRow>(
  col: ColumnDef<Row>,
): boolean {
  if (typeof col.editable === "boolean") return col.editable;
  return !isReadonlyCellType(col.type);
}

/** Narrow a `GridCommand` to a specific `kind`. */
export function isCommandOfKind<K extends GridCommandKind>(
  command: GridCommand,
  kind: K,
): command is Extract<GridCommand, { kind: K }> {
  return command.kind === kind;
}

/** True when two `CellCoord`s address the same cell. */
export function isSameCell(a: CellCoord, b: CellCoord): boolean {
  return a.rowId === b.rowId && a.colKey === b.colKey;
}
