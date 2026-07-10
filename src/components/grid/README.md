# DealSheet — the MemoryDeals data grid

An Excel-like, virtualized, generic data grid. Two rendering surfaces share one
engine:

- **`DealSheet`** — the desktop grid (keyboard-first, spreadsheet ergonomics).
- **`MobileCardEditor`** — the same data & engine re-projected as editable
  cards for touch.

Both take the **identical props** and are fully **decoupled from any domain
model**: they render whatever `Row extends GridRow` you pass and persist through
an injected `onSave`. There are no hardcoded "product" fields anywhere in the
engine.

```ts
import { DealSheet, MobileCardEditor } from "@/components/grid";
import { useIsMobile } from "@/components/common/use-is-mobile";
```

---

## Public API

```ts
interface DealSheetProps<Row extends GridRow = GridRow> {
  gridId: string;                         // namespaces saved views in localStorage
  rows: Row[];                            // the data
  columns: ColumnDef<Row>[];              // injected column config
  onSave: OnSave<Row>;                    // (rowId, patch) => Promise<void>
  onOpenImages?: (rowId: string) => void; // opens an image manager for ImageCell
  groupByKey?: keyof Row & string;        // optional row grouping
  makeBlankRow?: () => Row;               // enables the ghost quick-add row
  density?: "compact" | "comfortable";    // DealSheet only; initial density
  className?: string;
}

// MobileCardEditorProps === DealSheetProps (density is ignored on mobile).
```

`GridRow` is just `{ id: string } & Record<string, unknown>` — declare a
concrete row interface and the column keys are type-checked against it.

### `ColumnDef<Row>`

```ts
interface ColumnDef<Row> {
  key: keyof Row & string;
  header: string;
  type: "text" | "number" | "currency" | "percent"
      | "select" | "multi-tag" | "toggle" | "image" | "computed";
  width?: number;
  editable?: boolean;                 // defaults true, except `computed`
  pinned?: "left";                    // freeze to the left edge
  options?: { value: string; label: string; color?: string }[]; // select/multi-tag
  validate?: (value: unknown, row: Row) => string | null;       // null == valid
  compute?: (row: Row) => number | string;                      // for `computed`
  format?: (value: unknown) => string;                          // display text
}
```

**Money is integer paise.** `currency` cells store integer paise (see
`@/lib/money`). Editors convert to/from rupees only at the UI boundary; paste,
fill and bulk math all stay in paise.

### `OnSave<Row>`

```ts
type OnSave<Row> = (rowId: string, patch: Partial<Row>) => Promise<void>;
```

Resolve on success, **reject on failure**. The grid applies edits optimistically,
shows a per-row `saving → saved` pill, and on a rejected save exhausts retries,
rolls the optimistic edit back, and shows a **Retry** chip on that row. If your
rows carry an `updatedAt` token, a divergence after a save surfaces a
**Conflict** chip (stale-write detection).

---

## Engine overview

Everything is composed inside `useGridController` (internal), which threads the
four builder layers together:

| Layer | Module(s) | Responsibility |
| --- | --- | --- |
| **core** | `core/selection`, `core/keyboard`, `core/useVirtualRows`, `core/GridChrome` | Pure selection reducer, keyboard intent model, row/column virtualization, header/gutter/outline chrome. |
| **cells** | `cells/*`, `cells/index` (`cellRegistry`) | Typed `{ Renderer, Editor }` pair per `CellType`. Editors own their draft, validate live (red corner + tooltip), commit on Enter/blur. |
| **engine** | `engine/useAutosave`, `engine/useUndoRedo` | Debounced/coalesced optimistic autosave with rollback + conflict detection; undo/redo over a self-inverting command stack. |
| **data** | `data/clipboard`, `data/fill`, `data/bulk`, `data/savedViews`, `data/BulkActionBar` | TSV copy/paste, fill-down/series, bulk mutations, saved-view apply + persistence, the floating action bar. |

Multi-cell operations (paste, fill, bulk, clear) are each recorded as **one**
undoable command, so a single Ctrl+Z reverts the whole block.

---

## Keyboard map (desktop)

| Keys | Action |
| --- | --- |
| Arrows | Move active cell |
| Shift + Arrows | Extend selection |
| Ctrl/⌘ + Arrows | Jump to axis edge |
| Home / End, Ctrl+Home/End | Jump to grid corners |
| Tab / Shift+Tab | Next / previous cell |
| Enter / Shift+Enter | Commit + move down / up |
| Type a character | Start editing seeded with that char |
| F2 / Double-click | Start editing |
| Esc | Cancel edit, else collapse selection |
| Delete / Backspace | Clear selected cells |
| Ctrl/⌘ + C / X / V | Copy / cut / paste (TSV — Excel & Sheets compatible) |
| Ctrl/⌘ + D | Fill down from the top row of the selection |
| Ctrl/⌘ + A | Select all |
| Ctrl/⌘ + Z / Shift+Z (or Y) | Undo / redo |
| Ctrl/⌘ + F | Open in-grid search (Enter / Shift+Enter cycles matches) |

**Mouse:** click to select, shift-click / drag to extend, click a column header
to sort (Alt+click selects the column), drag the header edge to resize, drag the
header to reorder, click the pin to freeze/unfreeze, type in the header filter to
filter. Click the gutter number for whole-row selection.

**Mobile:** tap a field to edit inline (same editors), long-press a card to enter
multi-select, then use the bottom `BulkActionBar`.

---

## Wiring a product (main-repo integration)

The grid is additive and generic. Product code owns two things: the **column
config** and the **`onSave`**. Nothing about "product" leaks into the grid.

```tsx
"use client";
import { DealSheet, MobileCardEditor, type ColumnDef } from "@/components/grid";
import { useIsMobile } from "@/components/common/use-is-mobile";
import { formatPaise } from "@/lib/money";

interface ProductRow {
  id: string;
  name: string;
  sku: string;
  price: number;    // paise
  stock: string;
  active: boolean;
  updatedAt?: number;
}

const columns: ColumnDef<ProductRow>[] = [
  { key: "name", header: "Name", type: "text", pinned: "left", width: 220,
    validate: (v) => (String(v).trim() ? null : "Name is required") },
  { key: "sku", header: "SKU", type: "text", width: 140 },
  { key: "price", header: "Price", type: "currency", width: 120,
    format: (v) => formatPaise(v as number) },
  { key: "stock", header: "Stock", type: "select", width: 130,
    options: [
      { value: "in", label: "In stock", color: "emerald" },
      { value: "out", label: "Out", color: "red" },
    ] },
  { key: "active", header: "Active", type: "toggle", width: 90 },
];

export function ProductGrid({ rows }: { rows: ProductRow[] }) {
  const isMobile = useIsMobile();
  // Real product wiring: POST/PATCH the patch to your API here.
  const onSave = async (id: string, patch: Partial<ProductRow>) => {
    const res = await fetch(`/api/products/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error("save failed"); // reject → grid shows Retry
  };

  const props = { gridId: "products", rows, columns, onSave };
  return isMobile ? <MobileCardEditor {...props} /> : <DealSheet {...props} />;
}
```

That is the whole integration contract: **columns + `onSave`**. Saved views are
persisted per `gridId` in `localStorage`; swap in a server-backed store later by
replacing `data/savedViews`'s persistence layer without touching the surfaces.
