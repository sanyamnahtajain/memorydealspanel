/**
 * CategoryFormDialog — regression for the stale-closure save bug.
 *
 * The owner toggled "Require per-model breakdown by default" ON and saved;
 * the network payload carried `defaultAllocation: null` anyway. Cause:
 * handleSubmit's useCallback deps were missing `allocationOn`, so the
 * memoized submit kept the toggle's INITIAL value forever. These tests pin
 * the contract: whatever the switch shows at save time is what onSubmit
 * receives — both directions.
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/server/actions/categories", () => ({
  createCategoryImageUploadTargetAction: vi.fn(async () => ({
    ok: false,
    error: "not used here",
  })),
}));
vi.mock("browser-image-compression", () => ({ default: vi.fn() }));
vi.mock("@/components/common", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useIsMobile: () => false,
}));

import { CategoryFormDialog } from "./CategoryFormDialog";

afterEach(cleanup);

function renderDialog(
  onSubmit: (values: unknown) => Promise<string | null>,
  initial?: object,
) {
  render(
    <CategoryFormDialog
      open
      onOpenChange={() => {}}
      title="Edit category"
      submitLabel="Save changes"
      initial={{ name: "Tempered Glasses", ...initial }}
      onSubmit={onSubmit as never}
    />,
  );
}

describe("CategoryFormDialog — allocation default toggle", () => {
  it("submits allocationDefaultOn=true after toggling ON (stale-closure regression)", async () => {
    const onSubmit = vi.fn(async (_values: unknown) => null);
    renderDialog(onSubmit, { allocationDefaultOn: false });

    fireEvent.click(
      screen.getByRole("switch", {
        name: /require per-model breakdown by default/i,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: "Tempered Glasses",
      allocationDefaultOn: true,
    });
  });

  it("submits allocationDefaultOn=false after toggling OFF", async () => {
    const onSubmit = vi.fn(async (_values: unknown) => null);
    renderDialog(onSubmit, { allocationDefaultOn: true });

    fireEvent.click(
      screen.getByRole("switch", {
        name: /require per-model breakdown by default/i,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      allocationDefaultOn: false,
    });
  });

  it("an untouched toggle submits its seeded value", async () => {
    const onSubmit = vi.fn(async (_values: unknown) => null);
    renderDialog(onSubmit, { allocationDefaultOn: true });

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      allocationDefaultOn: true,
    });
  });
});
