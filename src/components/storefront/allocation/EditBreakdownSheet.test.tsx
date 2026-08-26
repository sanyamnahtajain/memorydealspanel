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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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
  initial: { modelId: string; name: string; qty: number }[],
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
});
