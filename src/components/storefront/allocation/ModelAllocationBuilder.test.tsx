/**
 * ModelAllocationBuilder — the bulk-order builder.
 *
 * Covered here: pack-sized stepping, the "+pack" quick add, inline per-row
 * pack errors (red text under the row, mirroring the server rule), the
 * search box filtering the chosen rows, the pinned "N models · M pcs" bar,
 * and the paste mode filling rows + reporting unmatched lines plainly.
 * Both server actions are mocked — this is a pure client-behaviour test.
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const searchDeviceModelsAction = vi.fn<
  (input: unknown) => Promise<{
    ok: true;
    data: { id: string; name: string; brandName: string | null }[];
  }>
>(async () => ({ ok: true, data: [] }));
vi.mock("@/server/actions/device-models", () => ({
  searchDeviceModelsAction: (input: unknown) => searchDeviceModelsAction(input),
}));

const matchBreakdownPasteAction = vi.fn();
vi.mock("@/server/actions/allocation-paste", () => ({
  matchBreakdownPasteAction: (input: unknown) => matchBreakdownPasteAction(input),
}));

import {
  ModelAllocationBuilder,
  type AllocationRow,
} from "./ModelAllocationBuilder";

afterEach(() => {
  cleanup();
  matchBreakdownPasteAction.mockReset();
  searchDeviceModelsAction.mockClear();
  searchDeviceModelsAction.mockResolvedValue({ ok: true, data: [] });
});

const S23: AllocationRow = { modelId: "a", name: "S23 Ultra", qty: 20 };
const IPHONE: AllocationRow = { modelId: "b", name: "iPhone 15", qty: 15 };

function renderBuilder(
  rows: AllocationRow[],
  onChange = vi.fn(),
  props: Partial<React.ComponentProps<typeof ModelAllocationBuilder>> = {},
) {
  render(
    <ModelAllocationBuilder
      value={rows}
      onChange={onChange}
      productId="64b0000000000000000000aa"
      moq={10}
      packMultiple={10}
      {...props}
    />,
  );
  return onChange;
}

describe("inline per-row pack errors", () => {
  it("flags an off-pack quantity under its own row, in red words", () => {
    renderBuilder([S23, IPHONE]);
    // iPhone 15 is at 15 — off the pack of 10.
    expect(screen.getByText("Order in packs of 10")).toBeInTheDocument();
    const qty = screen.getByLabelText("Quantity for iPhone 15");
    expect(qty).toHaveAttribute("aria-invalid", "true");
    // The valid row carries no error.
    expect(
      screen.getByLabelText("Quantity for S23 Ultra"),
    ).not.toHaveAttribute("aria-invalid");
  });

  it("summarises the damage in the pinned bar", () => {
    renderBuilder([S23, IPHONE]);
    expect(screen.getByText("2 models · 35 pcs")).toBeInTheDocument();
    expect(screen.getByText(/Fix 1 model marked in red/)).toBeInTheDocument();
  });

  it("a fully aligned split reads ready", () => {
    renderBuilder([S23, { ...IPHONE, qty: 30 }]);
    expect(screen.getByText("2 models · 50 pcs")).toBeInTheDocument();
    expect(screen.getByText("Ready to add")).toBeInTheDocument();
  });
});

describe("pack-sized stepping", () => {
  it("the + stepper moves to the NEXT multiple of the pack", () => {
    const onChange = renderBuilder([S23]);
    fireEvent.click(screen.getByLabelText("More S23 Ultra"));
    expect(onChange).toHaveBeenCalledWith([{ ...S23, qty: 30 }]);
  });

  it("the − stepper repairs an off-pack value down onto the pack", () => {
    const onChange = renderBuilder([IPHONE]);
    fireEvent.click(screen.getByLabelText("Fewer iPhone 15"));
    expect(onChange).toHaveBeenCalledWith([{ ...IPHONE, qty: 10 }]);
  });

  it("stepping below one pack removes the row", () => {
    const onChange = renderBuilder([{ ...S23, qty: 10 }]);
    fireEvent.click(screen.getByLabelText("Fewer S23 Ultra"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("the +pack quick add adds one pack", () => {
    const onChange = renderBuilder([S23]);
    fireEvent.click(screen.getByLabelText("Add one pack of 10 S23 Ultra"));
    expect(onChange).toHaveBeenCalledWith([{ ...S23, qty: 30 }]);
  });
});

describe("per-model minimum (allocation minPerModel)", () => {
  it("flags a row below the aligned minimum, in the server's own words", () => {
    // minPerModel 25 at packs of 10 aligns UP to 30 — 20 pcs is short.
    renderBuilder([S23], vi.fn(), { minPerModel: 25 });
    expect(screen.getByText("Order at least 30 pcs")).toBeInTheDocument();
    expect(screen.getByLabelText("Quantity for S23 Ultra")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByText(/Fix 1 model marked in red/)).toBeInTheDocument();
  });

  it("a row at the aligned minimum carries no error", () => {
    renderBuilder([{ ...S23, qty: 30 }], vi.fn(), { minPerModel: 25 });
    expect(screen.queryByText(/Order at least/)).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Quantity for S23 Ultra"),
    ).not.toHaveAttribute("aria-invalid");
  });

  it("a newly picked model starts AT the aligned minimum, not at one pack", async () => {
    searchDeviceModelsAction.mockResolvedValue({
      ok: true,
      data: [{ id: "c", name: "Pixel 8", brandName: "Google" }],
    });
    const onChange = renderBuilder([], vi.fn(), { minPerModel: 25 });
    fireEvent.change(screen.getByLabelText("Search device models"), {
      target: { value: "pixel" },
    });
    // Debounced server search → the result row appears, then gets picked.
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Pixel 8/ }));
    expect(onChange).toHaveBeenCalledWith([
      { modelId: "c", name: "Pixel 8", qty: 30 },
    ]);
  });

  it("without the knob a new model still starts at one pack", async () => {
    searchDeviceModelsAction.mockResolvedValue({
      ok: true,
      data: [{ id: "c", name: "Pixel 8", brandName: "Google" }],
    });
    const onChange = renderBuilder([]);
    fireEvent.change(screen.getByLabelText("Search device models"), {
      target: { value: "pixel" },
    });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Pixel 8/ }));
    expect(onChange).toHaveBeenCalledWith([
      { modelId: "c", name: "Pixel 8", qty: 10 },
    ]);
  });
});

describe("filtering the chosen rows", () => {
  it("typing in the search box narrows the visible rows", () => {
    renderBuilder([S23, IPHONE]);
    fireEvent.change(screen.getByLabelText("Search device models"), {
      target: { value: "s23" },
    });
    expect(screen.getByText("S23 Ultra")).toBeInTheDocument();
    expect(screen.queryByText("iPhone 15")).not.toBeInTheDocument();
    expect(screen.getByText(/Showing 1 of 2 models/)).toBeInTheDocument();
  });
});

describe("adding a custom (typed) model", () => {
  it("offers an 'Add as typed' row when the search matches nothing", async () => {
    const onChange = renderBuilder([]);
    fireEvent.change(screen.getByLabelText("Search device models"), {
      target: { value: "  Nokia   3310 " },
    });
    // The add row needs no server round-trip — it renders from the query.
    const addRow = await screen.findByRole("option", {
      name: /Add “Nokia 3310”/,
    });
    fireEvent.mouseDown(addRow);
    // Starts at one pack (rules.min), exactly like a master model.
    expect(onChange).toHaveBeenCalledWith([
      { modelId: null, custom: true, name: "Nokia 3310", qty: 10 },
    ]);
  });

  it("renders a custom row with a visible 'custom' tag, editable like any row", () => {
    const custom: AllocationRow = {
      modelId: null,
      custom: true,
      name: "Nokia 3310",
      qty: 20,
    };
    const onChange = renderBuilder([custom]);
    expect(screen.getByText("custom")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("More Nokia 3310"));
    expect(onChange).toHaveBeenCalledWith([{ ...custom, qty: 30 }]);
    fireEvent.click(screen.getByLabelText("Remove Nokia 3310"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("blocks a typed duplicate of an already-chosen row (case-insensitive)", async () => {
    const onChange = renderBuilder([S23]);
    fireEvent.change(screen.getByLabelText("Search device models"), {
      target: { value: "s23-ULTRA" },
    });
    const addRow = await screen.findByRole("option", { name: /Add “s23-ULTRA”/ });
    expect(addRow).toBeDisabled();
    expect(addRow).toHaveTextContent("Added");
    fireEvent.mouseDown(addRow);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("hides the add row when a suggestion IS the typed name — pick the master row", async () => {
    searchDeviceModelsAction.mockResolvedValue({
      ok: true,
      data: [{ id: "c", name: "Pixel 8", brandName: "Google" }],
    });
    renderBuilder([]);
    fireEvent.change(screen.getByLabelText("Search device models"), {
      target: { value: "pixel-8" },
    });
    await screen.findByRole("option", { name: /Pixel 8/ });
    expect(
      screen.queryByRole("option", { name: /Add “/ }),
    ).not.toBeInTheDocument();
  });
});

describe("paste mode", () => {
  it("fills the rows from a pasted list; a no-match line is kept as typed", async () => {
    matchBreakdownPasteAction.mockResolvedValue({
      ok: true,
      rows: [
        { modelId: "a", name: "S23 Ultra", qty: 50 },
        { modelId: "c", name: "Redmi Note 13", qty: 30 },
        { modelId: null, custom: true, name: "Nokia 3310", qty: 20 },
      ],
      addedAsTyped: ["Nokia 3310"],
      unreadable: [],
      overflow: 0,
    });

    const onChange = renderBuilder([S23]);
    fireEvent.click(screen.getByRole("button", { name: /Paste list/ }));
    fireEvent.change(screen.getByLabelText("Paste your model list"), {
      target: { value: "S23 Ultra 50\nRedmi Note 13 30\nNokia 3310 20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fill models" }));

    expect(
      await screen.findByText("Not in our list — added as typed: Nokia 3310"),
    ).toBeInTheDocument();
    expect(screen.getByText("Filled 3 models.")).toBeInTheDocument();
    // Existing row's qty replaced; new models appended — custom included.
    expect(onChange).toHaveBeenCalledWith([
      { ...S23, qty: 50 },
      { modelId: "c", name: "Redmi Note 13", qty: 30 },
      { modelId: null, custom: true, name: "Nokia 3310", qty: 20 },
    ]);
  });

  it("shows a retryable inline error when the match fails", async () => {
    matchBreakdownPasteAction.mockResolvedValue({
      ok: false,
      message: "Too many tries — wait a moment.",
    });
    renderBuilder([]);
    fireEvent.click(screen.getByRole("button", { name: /Paste list/ }));
    fireEvent.change(screen.getByLabelText("Paste your model list"), {
      target: { value: "S23 Ultra 50" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fill models" }));

    expect(
      await screen.findByText("Too many tries — wait a moment."),
    ).toBeInTheDocument();
    // The button is enabled again — the buyer can retry.
    expect(screen.getByRole("button", { name: "Fill models" })).toBeEnabled();
  });
});
