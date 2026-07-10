/**
 * DealSheet cells — shared component contract.
 *
 * Every cell type in this folder ships two components: a `Renderer` (the
 * passive display shown when the cell is not being edited) and, unless the
 * cell is inherently read-only, an `Editor` (the active-edit surface). The
 * grid engine (owned by another builder) mounts one or the other and wires
 * them through the props declared here.
 *
 * These props are intentionally generic: a cell knows nothing about the
 * domain model — it receives the current `value`, its `ColumnDef`, the whole
 * `row` (for `validate`/`compute` context), and a set of callbacks to commit
 * or cancel an edit. Money is integer paise; currency editors convert to/from
 * rupees at the UI boundary only.
 */

import type { ColumnDef, GridRow } from "@/components/grid/types";

/* -------------------------------------------------------------------------- */
/*  Injected cell actions                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Side-channel callbacks the engine injects into cells that need to reach
 * outside their own value (e.g. the image cell opening a gallery for its row).
 * All are optional: a cell degrades gracefully when a handler is absent.
 */
export interface CellActions {
  /** Open the image manager/gallery for a given row (fired by ImageCell). */
  onOpenImages?: (rowId: string) => void;
}

/* -------------------------------------------------------------------------- */
/*  Renderer props                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Props handed to a cell's display component. Renderers are pure and cheap —
 * they format `value` for reading and never mutate anything.
 */
export interface CellRendererProps<Row extends GridRow = GridRow> {
  /** Current stored value for this cell (paise for currency, string[] for tags, …). */
  value: unknown;
  /** The column this cell belongs to (type, options, format, compute, …). */
  column: ColumnDef<Row>;
  /** The full row — needed by `compute` and for context-aware rendering. */
  row: Row;
  /** Engine-injected side-channel callbacks (e.g. `onOpenImages`). */
  actions?: CellActions;
  /** Extra classes from the engine (alignment, density, selection state). */
  className?: string;
}

/* -------------------------------------------------------------------------- */
/*  Editor props                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Props handed to a cell's active-edit component. The editor owns its own
 * *draft* state; it calls `onCommit` with the next stored value on Enter/blur
 * (only when the draft is valid) and `onCancel` on Esc. When `column.validate`
 * rejects the draft, the editor keeps the draft on screen (never silently
 * drops input) and surfaces the error via a red corner + tooltip.
 */
export interface CellEditorProps<Row extends GridRow = GridRow> {
  /** Value at the moment editing began — the editor seeds its draft from this. */
  value: unknown;
  /** The column being edited. */
  column: ColumnDef<Row>;
  /** The full row, passed to `validate` alongside the candidate value. */
  row: Row;
  /**
   * Commit the edit. `next` is the value to STORE (paise for currency, etc.).
   * The engine persists it via the injected `onSave`. Editors must only call
   * this with a value that passed `column.validate`.
   */
  onCommit: (next: unknown) => void;
  /** Abandon the edit, discarding the draft and restoring the prior value. */
  onCancel: () => void;
  /**
   * Optional seed keystroke: when the user starts editing by typing a
   * character (rather than Enter/double-click), the engine passes it so the
   * editor can begin the draft with that character already entered.
   */
  initialInput?: string;
  /** Engine-injected side-channel callbacks (e.g. `onOpenImages`). */
  actions?: CellActions;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/*  Registry entry                                                            */
/* -------------------------------------------------------------------------- */

import type * as React from "react";

/** A cell type's pair of components. `Editor` is `null` for read-only types. */
export interface CellComponents {
  Renderer: React.ComponentType<CellRendererProps>;
  Editor: React.ComponentType<CellEditorProps> | null;
}

/* -------------------------------------------------------------------------- */
/*  Shared validation helper                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Runs `column.validate` (when present) against a candidate value, returning
 * an error message or `null`. Editors call this on every draft change so the
 * red-corner state stays live.
 */
export function runValidate<Row extends GridRow>(
  column: ColumnDef<Row>,
  candidate: unknown,
  row: Row,
): string | null {
  if (!column.validate) return null;
  try {
    return column.validate(candidate, row);
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid value";
  }
}
