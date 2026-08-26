/**
 * EditBreakdownSheet — the cart's "Edit models" editor.
 *
 * Covered here: a STORED split that violates the live per-model rules (off-
 * pack / below the per-model minimum) shows its inline row errors the moment
 * the sheet opens — before any tap — and Save stays locked until the split is
 * repaired. Mirrors exactly what the server enforces, so a save can never
 * bounce with a surprise toast. Server actions are mocked.
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/server/actions/device-models", () => ({
  searchDeviceModelsAction: vi.fn(async () => ({ ok: true, data: [] })),
}));
vi.mock("@/server/actions/allocation-paste", () => ({
  matchBreakdownPasteAction: vi.fn(async () => ({
    ok: true,
    rows: [],
    unmatched: [],
    unreadable: [],
    overflow: 0,
  })),
}));
const updateCartQuantityAction = vi.fn();
vi.mock("@/server/actions/cart", () => ({
  updateCartQuantityAction: (input: unknown) => updateCartQuantityAction(input),
}));

import { EditBreakdownSheet } from "./EditBreakdownSheet";

afterEach(() => {
  cleanup();
  updateCartQuantityAction.mockReset();
});

function renderSheet(
  initial: {
    modelId: string | null;
    custom?: boolean;
    name: string;
    qty: number;
  }[],
  minPerModel: number | null = null,
) {
  render(
    <EditBreakdownSheet
      productId="64b0000000000000000000aa"
      variantId={null}
      moq={10}
      packMultiple={10}
      minPerModel={minPerModel}
      initial={initial}
      onSaved={vi.fn()}
    />,
  );
}

describe("stored split validated on open", () => {
  it("a stored below-minimum row is flagged inline the moment the sheet opens", async () => {
    // minPerModel 25 aligns to 30 at packs of 10 — the stored 20 is short.
    renderSheet([{ modelId: "a", name: "S23 Ultra", qty: 20 }], 25);
    fireEvent.click(screen.getByRole("button", { name: /Edit models/ }));

    expect(
      await screen.findByText("Order at least 30 pcs"),
    ).toBeInTheDocument();
    // Save is locked until the row is repaired — no server bounce possible.
    expect(
      screen.getByRole("button", { name: /Save split/ }),
    ).toBeDisabled();
    expect(updateCartQuantityAction).not.toHaveBeenCalled();
  });

  it("a stored off-pack row is flagged inline on open, even with no minimum knob", async () => {
    renderSheet([{ modelId: "a", name: "S23 Ultra", qty: 15 }], null);
    fireEvent.click(screen.getByRole("button", { name: /Edit models/ }));

    expect(
      await screen.findByText("Order in packs of 10"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Save split/ }),
    ).toBeDisabled();
  });

  it("a healthy stored split opens clean with Save unlocked", async () => {
    renderSheet([{ modelId: "a", name: "S23 Ultra", qty: 30 }], 25);
    fireEvent.click(screen.getByRole("button", { name: /Edit models/ }));

    expect(
      await screen.findByRole("button", { name: /Save split \(30 units\)/ }),
    ).toBeEnabled();
    expect(screen.queryByText(/Order at least/)).not.toBeInTheDocument();
  });

  it("a CUSTOM (typed) stored line renders untagged and saves with the custom shape", async () => {
    updateCartQuantityAction.mockResolvedValue({
      ok: true,
      quantity: 30,
      itemCount: 30,
      lineCount: 1,
      clamped: false,
    });
    renderSheet([
      { modelId: "a", name: "S23 Ultra", qty: 20 },
      { modelId: null, custom: true, name: "Nokia 3310", qty: 10 },
    ]);
    fireEvent.click(screen.getByRole("button", { name: /Edit models/ }));

    // The typed line renders like any other (no badge — owner rule); the
    // full name is visible and the stored custom SHAPE is what must survive.
    expect(await screen.findByText("Nokia 3310")).toBeInTheDocument();
    expect(screen.queryByText("custom")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Save split \(30 units\)/ }),
    );

    // A successful save closes the sheet — wait on the action call itself.
    await waitFor(() => expect(updateCartQuantityAction).toHaveBeenCalled());
    expect(updateCartQuantityAction).toHaveBeenCalledWith({
      productId: "64b0000000000000000000aa",
      quantity: 30,
      breakdown: [
        { modelId: "a", qty: 20 },
        { custom: true, name: "Nokia 3310", qty: 10 },
      ],
    });
  });
});
