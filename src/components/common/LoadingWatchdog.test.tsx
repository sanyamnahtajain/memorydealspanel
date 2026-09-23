import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import { LoadingWatchdog } from "./LoadingWatchdog";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * Next's router has no navigation timeout; this component is the reason a
 * skeleton can no longer be the last thing a customer sees.
 */
describe("LoadingWatchdog", () => {
  it("is silent while a navigation is merely in progress", () => {
    vi.useFakeTimers();
    render(<LoadingWatchdog label="Loading category…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading category…");
    act(() => vi.advanceTimersByTime(7_000));
    expect(screen.queryByText(/taking longer/)).toBeNull();
  });

  it("offers a way out once it has taken too long", () => {
    vi.useFakeTimers();
    render(<LoadingWatchdog slowAfterMs={8_000} reloadAfterMs={60_000} />);
    act(() => vi.advanceTimersByTime(8_001));
    expect(screen.getByText(/taking longer than usual/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload/i })).toBeInTheDocument();
  });

  it("stops its timers when the page arrives", () => {
    vi.useFakeTimers();
    const { unmount } = render(<LoadingWatchdog slowAfterMs={1_000} reloadAfterMs={2_000} />);
    unmount();
    // Nothing throws, nothing reloads, nothing renders after unmount.
    expect(() => act(() => vi.advanceTimersByTime(5_000))).not.toThrow();
  });
});
