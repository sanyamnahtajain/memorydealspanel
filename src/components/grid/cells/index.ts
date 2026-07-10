/**
 * DealSheet cell registry — the single lookup the grid engine uses to resolve
 * a `CellType` to its `{ Renderer, Editor }` pair.
 *
 * Each cell type ships a passive `Renderer` and, unless inherently read-only,
 * an active `Editor` (or `null` for read-only types like `computed`). The
 * engine mounts the Renderer normally and swaps in the Editor for the actively
 * edited cell, wiring both through the shared `CellRendererProps` /
 * `CellEditorProps` contract in `./cell-props`.
 *
 * The registry is DECOUPLED from any domain: cells receive value + column +
 * row + injected actions, never hardcoded product fields.
 */

import type { CellType } from "@/components/grid/types";
import type {
  CellActions,
  CellComponents,
  CellEditorProps,
  CellRendererProps,
} from "./cell-props";

import { TextRenderer, TextEditor } from "./TextCell";
import { NumberRenderer, NumberEditor } from "./NumberCell";
import { CurrencyRenderer, CurrencyEditor } from "./CurrencyCell";
import { PercentRenderer, PercentEditor } from "./PercentCell";
import { SelectRenderer, SelectEditor } from "./SelectCell";
import { MultiTagRenderer, MultiTagEditor } from "./MultiTagCell";
import { ToggleRenderer, ToggleEditor } from "./ToggleCell";
import { ImageRenderer, ImageEditor } from "./ImageCell";
import { ComputedRenderer } from "./ComputedCell";

/* -------------------------------------------------------------------------- */
/*  Registry                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Maps every `CellType` to its display + edit components. `computed` has a
 * `null` Editor because it is derived and read-only.
 */
export const cellRegistry: Record<CellType, CellComponents> = {
  text: { Renderer: TextRenderer, Editor: TextEditor },
  number: { Renderer: NumberRenderer, Editor: NumberEditor },
  currency: { Renderer: CurrencyRenderer, Editor: CurrencyEditor },
  percent: { Renderer: PercentRenderer, Editor: PercentEditor },
  select: { Renderer: SelectRenderer, Editor: SelectEditor },
  "multi-tag": { Renderer: MultiTagRenderer, Editor: MultiTagEditor },
  toggle: { Renderer: ToggleRenderer, Editor: ToggleEditor },
  image: { Renderer: ImageRenderer, Editor: ImageEditor },
  computed: { Renderer: ComputedRenderer, Editor: null },
};

/** Resolve the components for a given cell type. */
export function getCellComponents(type: CellType): CellComponents {
  return cellRegistry[type];
}

/* -------------------------------------------------------------------------- */
/*  Public re-exports                                                         */
/* -------------------------------------------------------------------------- */

export type {
  CellActions,
  CellComponents,
  CellEditorProps,
  CellRendererProps,
};
export { runValidate } from "./cell-props";

export { TextRenderer, TextEditor } from "./TextCell";
export { NumberRenderer, NumberEditor } from "./NumberCell";
export { CurrencyRenderer, CurrencyEditor } from "./CurrencyCell";
export { PercentRenderer, PercentEditor } from "./PercentCell";
export { SelectRenderer, SelectEditor } from "./SelectCell";
export { MultiTagRenderer, MultiTagEditor } from "./MultiTagCell";
export { ToggleRenderer, ToggleEditor } from "./ToggleCell";
export { ImageRenderer, ImageEditor } from "./ImageCell";
export { ComputedRenderer } from "./ComputedCell";

// Value helpers other builders (engine, tests, assembler) may reuse.
export { textToDisplay } from "./TextCell";
export { numberToDisplay, parseNumberDraft } from "./NumberCell";
export { currencyToDisplay, paiseToRupeeInput } from "./CurrencyCell";
export {
  percentToDisplay,
  parsePercentDraft,
  percentBoundsError,
  PERCENT_MIN,
  PERCENT_MAX,
} from "./PercentCell";
export { toTagArray } from "./MultiTagCell";
export { toBool } from "./ToggleCell";
export { toImageList } from "./ImageCell";
export { computeValue, computedToDisplay } from "./ComputedCell";
export { chipStyle, findOption, OptionChip } from "./option-chip";
export { EditorShell } from "./editor-shell";
