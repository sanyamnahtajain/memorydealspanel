import { describe, expect, it } from "vitest";

import {
  countSelection,
  parseSelection,
  writeSelection,
  type FacetSelection,
} from "./types";

/**
 * The facet-selection URL contract, with the PRICE GATE as the headline
 * guarantee: a `band` param is only ever parsed OR written for an approved
 * viewer. A gated viewer can never carry, share, or receive a price band
 * through the URL — even from a link crafted by an approved user.
 */

describe("parseSelection", () => {
  it("parses brand / stock / tag / spec multi-values (comma + repeated)", () => {
    const params = new URLSearchParams();
    params.set("brand", "b1,b2");
    params.append("tag", "usb");
    params.append("tag", "hot,new");
    params.set("stock", "IN_STOCK,LOW");
    params.set("spec.capacity", "128GB,256GB");
    params.set("spec.speed", "130MB/s");

    const sel = parseSelection(params, false);
    expect(sel.brands).toEqual(["b1", "b2"]);
    expect(sel.tags).toEqual(["usb", "hot", "new"]);
    expect(sel.stock).toEqual(["IN_STOCK", "LOW"]);
    expect(sel.specs.capacity).toEqual(["128GB", "256GB"]);
    expect(sel.specs.speed).toEqual(["130MB/s"]);
  });

  it("drops unknown stock statuses", () => {
    const params = new URLSearchParams();
    params.set("stock", "IN_STOCK,BOGUS");
    expect(parseSelection(params, true).stock).toEqual(["IN_STOCK"]);
  });

  it("IGNORES the band param for a gated viewer", () => {
    const params = new URLSearchParams();
    params.set("band", "100-500");
    expect(parseSelection(params, false).band).toBeNull();
  });

  it("honours the band param for an approved viewer", () => {
    const params = new URLSearchParams();
    params.set("band", "100-500");
    expect(parseSelection(params, true).band).toBe("100-500");
  });
});

describe("writeSelection", () => {
  const selection: FacetSelection = {
    brands: ["b1", "b2"],
    specs: { capacity: ["128GB"] },
    stock: ["IN_STOCK"],
    tags: ["usb"],
    band: "100-500",
  };

  it("round-trips a selection through the URL for an approved viewer", () => {
    const written = writeSelection(new URLSearchParams(), selection, true);
    const reparsed = parseSelection(written, true);
    expect(reparsed).toEqual(selection);
  });

  it("NEVER writes a band param for a gated viewer", () => {
    const written = writeSelection(new URLSearchParams(), selection, false);
    expect(written.has("band")).toBe(false);
    // Everything else still round-trips.
    const reparsed = parseSelection(written, false);
    expect(reparsed.brands).toEqual(["b1", "b2"]);
    expect(reparsed.band).toBeNull();
  });

  it("preserves unrelated params (view / sort / q)", () => {
    const base = new URLSearchParams({ q: "sandisk", view: "table", sort: "name" });
    const written = writeSelection(base, selection, true);
    expect(written.get("q")).toBe("sandisk");
    expect(written.get("view")).toBe("table");
    expect(written.get("sort")).toBe("name");
  });

  it("clears stale facet params when a selection empties", () => {
    const base = writeSelection(new URLSearchParams(), selection, true);
    const empty: FacetSelection = {
      brands: [],
      specs: {},
      stock: [],
      tags: [],
      band: null,
    };
    const cleared = writeSelection(base, empty, true);
    expect(cleared.has("brand")).toBe(false);
    expect(cleared.has("stock")).toBe(false);
    expect(cleared.has("tag")).toBe(false);
    expect(cleared.has("band")).toBe(false);
    expect(cleared.has("spec.capacity")).toBe(false);
  });
});

describe("countSelection", () => {
  it("counts every active facet value including a band", () => {
    expect(
      countSelection({
        brands: ["b1", "b2"],
        specs: { capacity: ["128GB", "256GB"], speed: ["130"] },
        stock: ["IN_STOCK"],
        tags: ["usb"],
        band: "100-500",
      }),
    ).toBe(8);
  });

  it("is zero for an empty selection", () => {
    expect(
      countSelection({ brands: [], specs: {}, stock: [], tags: [], band: null }),
    ).toBe(0);
  });
});
