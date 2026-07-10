/**
 * Saved views — pure helpers to apply, serialize and persist a {@link SavedView}
 * (filter + sort + hide + column order) plus a thin localStorage layer keyed by
 * `gridId`.
 *
 * The "apply" helpers are pure and framework-free so they can run on the server
 * or in tests; persistence is guarded so it degrades gracefully when
 * localStorage is unavailable (SSR, private mode).
 *
 * Import types from '@/components/grid/types'.
 */

import type {
  ColumnDef,
  GridRow,
  SavedView,
  SortSpec,
} from "@/components/grid/types";

/* -------------------------------------------------------------------------- */
/*  Apply — filter / sort / order / visibility                               */
/* -------------------------------------------------------------------------- */

/**
 * Filter rows by a view's per-column query map. A query matches when the
 * column's display/string value contains the query text (case-insensitive).
 * Empty queries are ignored. All active filters must match (AND).
 */
export function applyFilters<Row extends GridRow>(
  rows: Row[],
  filters: Record<string, string>,
  columns: ColumnDef<Row>[],
): Row[] {
  const active = Object.entries(filters).filter(([, q]) => q.trim() !== "");
  if (active.length === 0) return rows;
  const colByKey = new Map(columns.map((c) => [c.key as string, c]));

  return rows.filter((row) =>
    active.every(([key, query]) => {
      const col = colByKey.get(key);
      const text = renderFilterText(row[key as keyof Row], col);
      return text.toLowerCase().includes(query.trim().toLowerCase());
    }),
  );
}

function renderFilterText<Row extends GridRow>(
  value: unknown,
  col?: ColumnDef<Row>,
): string {
  if (value === null || value === undefined) return "";
  if (col?.format) {
    try {
      return col.format(value);
    } catch {
      /* fall through to default stringify */
    }
  }
  if (Array.isArray(value)) return value.join(" ");
  return String(value);
}

/**
 * Sort rows by a view's ordered {@link SortSpec} list (primary first). Returns
 * a new array; the input is not mutated. Uses a stable comparison that handles
 * numbers, strings, booleans and null/undefined (nullish sorts last on asc).
 */
export function applySort<Row extends GridRow>(
  rows: Row[],
  sort: SortSpec[],
): Row[] {
  if (sort.length === 0) return rows;
  // Decorate-sort-undecorate keeps sort stable across engines.
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      for (const spec of sort) {
        const cmp = compareValues(
          a.row[spec.colKey as keyof Row],
          b.row[spec.colKey as keyof Row],
        );
        if (cmp !== 0) return spec.dir === "asc" ? cmp : -cmp;
      }
      return a.i - b.i; // stable tie-break by original index
    })
    .map((d) => d.row);
}

function compareValues(a: unknown, b: unknown): number {
  const an = a === null || a === undefined;
  const bn = b === null || b === undefined;
  if (an && bn) return 0;
  if (an) return 1; // nullish last on ascending
  if (bn) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") {
    return a === b ? 0 : a ? 1 : -1;
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/**
 * Order and filter columns for display: apply the view's `columnOrder` (unknown
 * keys keep their original relative order, appended after ordered ones), then
 * drop any column whose key is in `hidden`.
 */
export function applyColumnLayout<Row extends GridRow>(
  columns: ColumnDef<Row>[],
  view: Pick<SavedView, "columnOrder" | "hidden">,
): ColumnDef<Row>[] {
  const hidden = new Set(view.hidden);
  const orderIndex = new Map(view.columnOrder.map((k, i) => [k, i]));
  const ordered = columns
    .filter((c) => !hidden.has(c.key as string))
    .slice()
    .sort((a, b) => {
      const ai = orderIndex.get(a.key as string);
      const bi = orderIndex.get(b.key as string);
      if (ai === undefined && bi === undefined) return 0;
      if (ai === undefined) return 1;
      if (bi === undefined) return -1;
      return ai - bi;
    });
  return ordered;
}

/**
 * Apply a full view to a dataset in one call: filter → sort rows, and compute
 * the visible/ordered columns. Returns both so the caller can render directly.
 */
export function applyView<Row extends GridRow>(
  rows: Row[],
  columns: ColumnDef<Row>[],
  view: SavedView,
): { rows: Row[]; columns: ColumnDef<Row>[] } {
  const filtered = applyFilters(rows, view.filters, columns);
  const sorted = applySort(filtered, view.sort);
  const laidOut = applyColumnLayout(columns, view);
  return { rows: sorted, columns: laidOut };
}

/* -------------------------------------------------------------------------- */
/*  Serialize / normalize                                                     */
/* -------------------------------------------------------------------------- */

/** A brand-new empty view (no filters/sort/hidden, natural column order). */
export function createEmptyView(id: string, name: string): SavedView {
  return { id, name, filters: {}, sort: [], hidden: [], columnOrder: [] };
}

/**
 * Normalize an untrusted object (e.g. parsed JSON) into a valid
 * {@link SavedView}, dropping malformed fields. Returns null when the object
 * can't be a view at all (missing id/name).
 */
export function normalizeView(input: unknown): SavedView | null {
  if (typeof input !== "object" || input === null) return null;
  const o = input as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.name !== "string") return null;

  const filters: Record<string, string> = {};
  if (o.filters && typeof o.filters === "object") {
    for (const [k, v] of Object.entries(o.filters as Record<string, unknown>)) {
      if (typeof v === "string") filters[k] = v;
    }
  }

  const sort: SortSpec[] = Array.isArray(o.sort)
    ? o.sort
        .filter(
          (s): s is SortSpec =>
            typeof s === "object" &&
            s !== null &&
            typeof (s as SortSpec).colKey === "string" &&
            ((s as SortSpec).dir === "asc" || (s as SortSpec).dir === "desc"),
        )
        .map((s) => ({ colKey: s.colKey, dir: s.dir }))
    : [];

  const hidden = Array.isArray(o.hidden)
    ? o.hidden.filter((k): k is string => typeof k === "string")
    : [];
  const columnOrder = Array.isArray(o.columnOrder)
    ? o.columnOrder.filter((k): k is string => typeof k === "string")
    : [];

  return { id: o.id, name: o.name, filters, sort, hidden, columnOrder };
}

/** Serialize a list of views to a JSON string for storage. */
export function serializeViews(views: SavedView[]): string {
  return JSON.stringify(views);
}

/** Parse and normalize a stored JSON string into a list of valid views. */
export function deserializeViews(json: string): SavedView[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeView)
      .filter((v): v is SavedView => v !== null);
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/*  Persistence (localStorage, keyed by gridId)                              */
/* -------------------------------------------------------------------------- */

const STORAGE_PREFIX = "dealsheet:views:";

function storageKey(gridId: string): string {
  return `${STORAGE_PREFIX}${gridId}`;
}

/** Safe accessor: returns the Storage or null when unavailable (SSR/private). */
function getStorage(): Storage | null {
  try {
    if (typeof globalThis === "undefined") return null;
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls) return null;
    return ls;
  } catch {
    return null;
  }
}

/** Load all saved views for a grid. Returns [] when none / storage missing. */
export function loadViews(gridId: string): SavedView[] {
  const ls = getStorage();
  if (!ls) return [];
  const raw = ls.getItem(storageKey(gridId));
  if (!raw) return [];
  return deserializeViews(raw);
}

/** Persist the full set of views for a grid. No-op when storage is missing. */
export function saveViews(gridId: string, views: SavedView[]): void {
  const ls = getStorage();
  if (!ls) return;
  try {
    ls.setItem(storageKey(gridId), serializeViews(views));
  } catch {
    /* quota / disabled — silently ignore, views are non-critical */
  }
}

/**
 * Upsert a single view into a grid's stored set (matched by id) and persist.
 * Returns the updated list so callers can refresh their in-memory state.
 */
export function upsertView(gridId: string, view: SavedView): SavedView[] {
  const views = loadViews(gridId);
  const i = views.findIndex((v) => v.id === view.id);
  if (i >= 0) views[i] = view;
  else views.push(view);
  saveViews(gridId, views);
  return views;
}

/** Remove a view by id from a grid's stored set and persist. Returns the rest. */
export function deleteView(gridId: string, viewId: string): SavedView[] {
  const views = loadViews(gridId).filter((v) => v.id !== viewId);
  saveViews(gridId, views);
  return views;
}
