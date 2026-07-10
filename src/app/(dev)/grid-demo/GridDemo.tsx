"use client";

/**
 * Client-side DealSheet demo. Generates 5,000 fake product rows, wires an
 * in-memory `onSave` with simulated 300ms latency and an occasional failure
 * (so the per-row Retry chip + optimistic rollback are visible), and persists
 * edits to localStorage so a refresh keeps your changes.
 *
 * Renders `DealSheet` on desktop and `MobileCardEditor` on narrow viewports.
 */

import * as React from "react";
import { toast } from "sonner";

import { DealSheet, MobileCardEditor, type ColumnDef } from "@/components/grid";
import { useIsMobile } from "@/components/common/use-is-mobile";
import { formatPaise } from "@/lib/money";
import { AppToaster } from "@/components/common/Toaster";

/* -------------------------------------------------------------------------- */
/*  Row model (demo-only — the grid engine never sees these fields)           */
/* -------------------------------------------------------------------------- */

interface ProductRow {
  id: string;
  name: string;
  sku: string;
  brand: string;
  category: string;
  price: number; // integer paise
  mrp: number; // integer paise
  stock: string;
  active: boolean;
  tags: string[];
  /** Derived (computed) — margin % of price vs MRP. */
  margin: number;
  /** Optimistic-concurrency token for conflict detection. */
  updatedAt: number;
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------- */
/*  Fake data                                                                 */
/* -------------------------------------------------------------------------- */

const BRANDS = [
  "Kingston",
  "Corsair",
  "Samsung",
  "Crucial",
  "WD",
  "Seagate",
  "SanDisk",
  "G.Skill",
  "ADATA",
  "Transcend",
];
const CATEGORIES = [
  { value: "ram", label: "RAM", color: "indigo" },
  { value: "ssd", label: "SSD", color: "emerald" },
  { value: "hdd", label: "HDD", color: "amber" },
  { value: "usb", label: "USB Drive", color: "sky" },
  { value: "sdcard", label: "SD Card", color: "violet" },
];
const STOCK = [
  { value: "in", label: "In stock", color: "emerald" },
  { value: "low", label: "Low", color: "amber" },
  { value: "out", label: "Out of stock", color: "red" },
];
const TAGS = ["hot", "clearance", "new", "bulk", "oem", "retail", "warranty"];

/** Small seeded PRNG so the demo dataset is stable across reloads. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRows(count: number): ProductRow[] {
  const rand = mulberry32(1337);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  const rows: ProductRow[] = [];
  for (let i = 0; i < count; i++) {
    const brand = pick(BRANDS);
    const category = pick(CATEGORIES).value;
    const capacity = pick([8, 16, 32, 64, 128, 256, 512, 1024]);
    const mrp = (500 + Math.floor(rand() * 20000)) * 100; // paise
    const price = Math.round(mrp * (0.6 + rand() * 0.35));
    const tagCount = Math.floor(rand() * 3);
    const tags = Array.from(
      new Set(Array.from({ length: tagCount }, () => pick(TAGS))),
    );
    rows.push({
      id: `p_${i.toString(36)}`,
      name: `${brand} ${category.toUpperCase()} ${capacity}GB`,
      sku: `SKU-${(100000 + i).toString()}`,
      brand,
      category,
      price,
      mrp,
      stock: pick(STOCK).value,
      active: rand() > 0.2,
      tags,
      margin: 0, // computed column ignores this stored value
      updatedAt: 0, // deterministic seed → stable SSR/client hydration
    });
  }
  return rows;
}

/* -------------------------------------------------------------------------- */
/*  Columns (the injected config — this is all "product" the grid knows)      */
/* -------------------------------------------------------------------------- */

const columns: ColumnDef<ProductRow>[] = [
  {
    key: "name",
    header: "Product",
    type: "text",
    width: 220,
    pinned: "left",
    validate: (v) =>
      String(v ?? "").trim().length > 0 ? null : "Name is required",
  },
  { key: "sku", header: "SKU", type: "text", width: 130 },
  { key: "brand", header: "Brand", type: "text", width: 120 },
  {
    key: "category",
    header: "Category",
    type: "select",
    width: 130,
    options: CATEGORIES,
  },
  {
    key: "price",
    header: "Price",
    type: "currency",
    width: 120,
    format: (v) => (typeof v === "number" ? formatPaise(v) : ""),
    validate: (v) =>
      typeof v === "number" && v >= 0 ? null : "Price must be ≥ 0",
  },
  {
    key: "mrp",
    header: "MRP",
    type: "currency",
    width: 120,
    format: (v) => (typeof v === "number" ? formatPaise(v) : ""),
  },
  { key: "stock", header: "Stock", type: "select", width: 130, options: STOCK },
  { key: "active", header: "Active", type: "toggle", width: 90 },
  {
    key: "tags",
    header: "Tags",
    type: "multi-tag",
    width: 200,
    options: TAGS.map((t) => ({ value: t, label: t })),
  },
  {
    key: "margin",
    header: "Margin",
    type: "computed",
    width: 100,
    compute: (row) => {
      const mrp = typeof row.mrp === "number" ? row.mrp : 0;
      const price = typeof row.price === "number" ? row.price : 0;
      if (mrp <= 0) return "—";
      const pct = ((mrp - price) / mrp) * 100;
      return `${pct.toFixed(1)}%`;
    },
  },
];

/* -------------------------------------------------------------------------- */
/*  In-memory persistence (with localStorage overlay + simulated failures)    */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = "dealsheet:demo:rows";

/** Load the base dataset, then overlay any locally-persisted edits. */
function loadInitialRows(): ProductRow[] {
  const base = makeRows(5000);
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const overlay = JSON.parse(raw) as Record<string, Partial<ProductRow>>;
    return base.map((row) =>
      overlay[row.id] ? { ...row, ...overlay[row.id] } : row,
    );
  } catch {
    return base;
  }
}

/* -------------------------------------------------------------------------- */
/*  Demo component                                                            */
/* -------------------------------------------------------------------------- */

export function GridDemo() {
  const isMobile = useIsMobile();
  const [rows, setRows] = React.useState<ProductRow[]>([]);

  // Hydrate rows from the external localStorage overlay on mount. This is a
  // legitimate effect: it syncs React state from an external system (Storage)
  // that isn't available during SSR, so the server renders the empty shell and
  // the client fills it in — avoiding a hydration mismatch on the overlay.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows(loadInitialRows());
  }, []);

  // A localStorage overlay of edits, keyed by row id.
  const overlayRef = React.useRef<Record<string, Partial<ProductRow>>>({});

  const persistOverlay = React.useCallback(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(overlayRef.current),
      );
    } catch {
      /* quota / disabled — demo edits just won't survive a refresh */
    }
  }, []);

  const onSave = React.useCallback(
    (rowId: string, patch: Partial<ProductRow>) =>
      new Promise<void>((resolve, reject) => {
        // Simulated network latency.
        window.setTimeout(() => {
          // ~12% of saves fail so the Retry chip + rollback are demonstrable.
          if (Math.random() < 0.12) {
            reject(new Error("Simulated network error"));
            return;
          }
          // Success: fold the patch into the localStorage overlay and bump the
          // concurrency token so conflict detection has something to compare.
          overlayRef.current[rowId] = {
            ...overlayRef.current[rowId],
            ...patch,
            updatedAt: Date.now(),
          };
          persistOverlay();
          resolve();
        }, 300);
      }),
    [persistOverlay],
  );

  const resetDemo = React.useCallback(() => {
    overlayRef.current = {};
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setRows(makeRows(5000));
    toast.success("Demo data reset");
  }, []);

  const commonProps = {
    gridId: "demo-products",
    rows,
    columns,
    onSave,
    onOpenImages: (id: string) => toast.info(`Open images for ${id}`),
    groupByKey: "category" as const,
    makeBlankRow: (): ProductRow => ({
      id: `p_new_${Date.now().toString(36)}`,
      name: "",
      sku: "",
      brand: "",
      category: "ram",
      price: 0,
      mrp: 0,
      stock: "in",
      active: true,
      tags: [],
      margin: 0,
      updatedAt: Date.now(),
    }),
  };

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-4 py-2">
        <h1 className="text-sm font-semibold">DealSheet — dev playground</h1>
        <span className="text-xs text-muted-foreground tabular-nums">
          {rows.length.toLocaleString()} rows · {isMobile ? "mobile" : "desktop"}
        </span>
        <button
          type="button"
          onClick={resetDemo}
          className="ml-auto rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Reset demo data
        </button>
      </header>

      <main className="min-h-0 flex-1 p-3">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Generating 5,000 rows…
          </p>
        ) : isMobile ? (
          <MobileCardEditor {...commonProps} />
        ) : (
          <DealSheet {...commonProps} />
        )}
      </main>

      <AppToaster />
    </div>
  );
}

export default GridDemo;
