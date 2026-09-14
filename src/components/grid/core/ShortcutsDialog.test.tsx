import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { GridShortcutsDialog } from "./ShortcutsDialog";

afterEach(cleanup);

/**
 * The cheat sheet is the discoverability half of "keyboard friendly" — the
 * grid's shortcuts existed long before anything told an operator so.
 */
describe("GridShortcutsDialog", () => {
  it("lists the keys an operator actually needs, grouped", () => {
    render(<GridShortcutsDialog open onOpenChange={() => {}} />);

    for (const group of [
      "Moving around",
      "Selecting",
      "Editing",
      "Filling and history",
    ]) {
      expect(screen.getByText(group)).toBeInTheDocument();
    }

    // The newly-added navigation, which is the reason this pass happened.
    expect(screen.getByText(/Move a screenful of rows/)).toBeInTheDocument();
    expect(
      screen.getByText(/First \/ last column of this row/),
    ).toBeInTheDocument();
    // …and the distinct whole-sheet jump, so the two are not confused.
    expect(screen.getByText(/First cell of the sheet/)).toBeInTheDocument();
  });

  it("renders a modifier key label rather than a placeholder", () => {
    // jsdom reports a non-Mac platform, so the literal "mod" token must have
    // been substituted — printing "mod" to an operator would be a bug.
    render(<GridShortcutsDialog open onOpenChange={() => {}} />);
    expect(screen.queryByText("mod")).not.toBeInTheDocument();
    expect(screen.getAllByText("Ctrl").length).toBeGreaterThan(0);
  });

  it("renders nothing while closed", () => {
    render(<GridShortcutsDialog open={false} onOpenChange={() => {}} />);
    expect(screen.queryByText("Moving around")).not.toBeInTheDocument();
  });
});
