/**
 * DealSheet grid — public barrel.
 *
 * The two surface components (`DealSheet` desktop, `MobileCardEditor` touch)
 * share the same generic props and the same engine. Product code wires a grid
 * by injecting a `ColumnDef<Row>[]` config and an async `OnSave<Row>` — see
 * `./README.md` for the integration recipe.
 */

export { DealSheet, type DealSheetProps } from "./DealSheet";
export {
  MobileCardEditor,
  type MobileCardEditorProps,
} from "./MobileCardEditor";

// The full public type contract (row/column/command/view types + guards).
export type {
  CellType,
  GridRow,
  CellOption,
  ColumnDef,
  CellCoord,
  CellRange,
  CellChange,
  SaveStatus,
  RowSaveState,
  OnSave,
  GridCommand,
  GridCommandKind,
  SortSpec,
  SavedView,
} from "./types";
export {
  READONLY_CELL_TYPES,
  isGridRow,
  isReadonlyCellType,
  isColumnEditable,
  isCommandOfKind,
  isSameCell,
} from "./types";
