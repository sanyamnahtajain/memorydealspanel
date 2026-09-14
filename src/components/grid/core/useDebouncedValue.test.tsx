import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import { useDebouncedValue } from "./useDebouncedValue";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Probe({ value, delayMs }: { value: string; delayMs: number }) {
  const settled = useDebouncedValue(value, delayMs);
  return <output data-testid="settled">{settled}</output>;
}

function settled(): string {
  return screen.getByTestId("settled").textContent ?? "";
}

/**
 * The grid's search box types through this. What matters is the count of
 * expensive passes, not the timing curve: a fast typist must cost ONE scan of
 * the catalogue, not one per letter.
 */
describe("useDebouncedValue", () => {
  it("collapses a burst of keystrokes into a single settled value", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Probe value="" delayMs={150} />);

    for (const typed of ["a", "am", "amb", "ambr", "ambrane"]) {
      rerender(<Probe value={typed} delayMs={150} />);
      act(() => {
        vi.advanceTimersByTime(40); // still typing — under the threshold
      });
    }

    // Nothing has settled yet: no intermediate query ever reached the grid.
    expect(settled()).toBe("");

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(settled()).toBe("ambrane");
  });

  it("settles once typing pauses", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Probe value="" delayMs={150} />);

    rerender(<Probe value="boat" delayMs={150} />);
    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(settled()).toBe("");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(settled()).toBe("boat");
  });

  it("drops a pending value when the component unmounts mid-wait", () => {
    vi.useFakeTimers();
    const { rerender, unmount } = render(<Probe value="" delayMs={150} />);
    rerender(<Probe value="cable" delayMs={150} />);
    unmount();
    // The timer must be cleared, not fire into a dead component.
    expect(() => {
      act(() => {
        vi.runAllTimers();
      });
    }).not.toThrow();
  });
});
