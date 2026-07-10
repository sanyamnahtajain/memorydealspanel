/**
 * ACCEPTANCE CRITERION 3 — SCALE.
 *
 * Proves the DealSheet grid keeps the DOM bounded at 5,000 rows: only the rows
 * inside the viewport (plus overscan) are ever mounted, NOT all 5,000. Two
 * complementary checks:
 *
 *  1. HOOK-level: drive `useVirtualRows` with a 5,000-row count and a stubbed
 *     600px scroll element, and assert the number of `virtualRows` it returns is
 *     a small bounded window (a few dozen), independent of the dataset size.
 *     This is the load-bearing proof — DealSheet renders exactly one DOM row per
 *     entry in `virtualRows`.
 *
 *  2. RENDER-level: mount the full <DealSheet/> with 5,000 rows and confirm the
 *     mounted `role="row"` node count is far below the dataset size.
 *
 * jsdom has no layout engine (every element reports 0×0 and its ResizeObserver
 * never fires), so the measurement surface `@tanstack/react-virtual` reads is
 * stubbed to emulate a real 600px viewport.
 */
import * as React from "react";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook } from "@testing-library/react";

import { DealSheet, type ColumnDef } from "@/components/grid";
import { useVirtualRows } from "@/components/grid/core/useVirtualRows";

const ROW_COUNT = 5000;
const VIEWPORT_HEIGHT = 600; // px — height we give the scroll element.
const ROW_HEIGHT_COMPACT = 28; // px — matches ROW_HEIGHT.compact in the hook.

interface Row {
  id: string;
  name: string;
  sku: string;
  price: number;
  [key: string]: unknown;
}

const columns: ColumnDef<Row>[] = [
  { key: "name", header: "Name", type: "text", width: 200, pinned: "left" },
  { key: "sku", header: "SKU", type: "text", width: 140 },
  {
    key: "price",
    header: "Price",
    type: "currency",
    width: 120,
    format: (v) => (typeof v === "number" ? String(v) : ""),
  },
];

function makeRows(n: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({ id: `r_${i}`, name: `Row ${i}`, sku: `SKU-${i}`, price: i * 100 });
  }
  return rows;
}

/**
 * A minimal scroll element that reports a fixed 600px viewport to the hook.
 * react-virtual v3 measures the container via `offsetWidth`/`offsetHeight` (see
 * `getRect` in virtual-core) and the scroll offset via `scrollTop`, so those are
 * the properties we stub — jsdom returns 0 for all of them by default.
 */
function makeScrollElement(): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "offsetHeight", { value: VIEWPORT_HEIGHT });
  Object.defineProperty(el, "offsetWidth", { value: 800 });
  Object.defineProperty(el, "clientHeight", { value: VIEWPORT_HEIGHT });
  Object.defineProperty(el, "clientWidth", { value: 800 });
  Object.defineProperty(el, "scrollHeight", { value: ROW_COUNT * ROW_HEIGHT_COMPACT });
  Object.defineProperty(el, "scrollTop", { value: 0, writable: true });
  document.body.appendChild(el);
  return el;
}

beforeAll(() => {
  // A ResizeObserver that immediately reports the observed element's (stubbed)
  // size to its callback — react-virtual relies on this firing to learn the
  // viewport height. It reports via the element's offset box (see below).
  class RO {
    constructor(private cb: ResizeObserverCallback) {}
    observe(target: Element) {
      const el = target as HTMLElement;
      this.cb(
        [
          {
            target,
            borderBoxSize: [
              { inlineSize: el.offsetWidth, blockSize: el.offsetHeight },
            ],
            contentRect: {} as DOMRectReadOnly,
          } as unknown as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = RO as unknown as typeof ResizeObserver;
  // react-virtual reads `instance.targetWindow.ResizeObserver` (the scroll
  // element's ownerDocument window), so it must exist on `window` too.
  window.ResizeObserver = RO as unknown as typeof ResizeObserver;

  // react-virtual measures the scroll container via `offsetHeight`/`offsetWidth`
  // (jsdom returns 0). Report the 600px viewport for the grid scroller and a
  // nonzero box for everything else so measurement never divides by zero.
  Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.getAttribute("role") === "grid") return VIEWPORT_HEIGHT;
      return Number(this.style.height?.replace("px", "")) || ROW_HEIGHT_COMPACT;
    },
  });
  Object.defineProperty(window.HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return 800;
    },
  });
});

afterEach(() => {
  cleanup();
});

describe("SCALE: 5,000 rows stay virtualized (bounded DOM)", () => {
  it("useVirtualRows returns a bounded visible window, not all 5,000 rows", async () => {
    const scrollElement = makeScrollElement();

    const { result, rerender } = renderHook(() =>
      useVirtualRows({
        rowCount: ROW_COUNT,
        columnWidths: [200, 140, 120],
        density: "compact",
        scrollElement,
        pinnedColumnCount: 0,
        getRowKey: (i) => `r_${i}`,
      }),
    );

    // Flush the virtualizer's mount effect (which attaches the ResizeObserver
    // that reports the 600px viewport) and re-render so the computed window is
    // reflected in the hook result.
    await act(async () => {
      await Promise.resolve();
    });
    rerender();

    const windowSize = result.current.virtualRows.length;

    // eslint-disable-next-line no-console
    console.log(
      `[SCALE:hook] dataset=${ROW_COUNT} viewport=${VIEWPORT_HEIGHT}px ` +
        `rowHeight=${result.current.rowHeight}px virtualRows=${windowSize} ` +
        `totalHeight=${result.current.totalHeight}px`,
    );

    // The virtual spacer is sized for the FULL dataset (5000 * 28 = 140000px)…
    expect(result.current.totalHeight).toBe(ROW_COUNT * ROW_HEIGHT_COMPACT);

    // …but only a viewport-sized window of rows is materialized. 600/28 ≈ 22
    // visible + 8 overscan each side ⇒ ~30–40. Assert it's bounded and small.
    expect(windowSize).toBeGreaterThan(0);
    expect(windowSize).toBeLessThan(80);
    expect(windowSize).toBeLessThan(ROW_COUNT / 50);
  });

  it("<DealSheet/> mounts far fewer than 5,000 row nodes", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <div style={{ height: VIEWPORT_HEIGHT }}>
          <DealSheet<Row>
            gridId="scale-test"
            rows={makeRows(ROW_COUNT)}
            columns={columns}
            onSave={onSave}
          />
        </div>,
      ));
    });

    const mounted = container.querySelectorAll('[role="row"]').length;

    // eslint-disable-next-line no-console
    console.log(`[SCALE:render] dataset=${ROW_COUNT} mounted role=row nodes=${mounted}`);

    // Bounded: at least one row, and dramatically fewer than the dataset. The
    // ceiling is generous to absorb jsdom's async-measurement quirks while still
    // being ~25× below the 5,000-row total — impossible to pass without
    // virtualization.
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(200);
    expect(mounted).toBeLessThan(ROW_COUNT / 10);
  });
});
