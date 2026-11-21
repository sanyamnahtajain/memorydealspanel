import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import { ActivityBar } from "./ActivityBar";
import { _resetActivityForTests, beginActivity, markGesture } from "@/lib/activity";

const realFetch = window.fetch;

beforeEach(() => {
  vi.useFakeTimers();
  _resetActivityForTests();
  window.__mdHydrated = false;
  window.__mdTap = undefined;
  window.__mdFetchPatched = false;
  window.fetch = vi.fn(async () => new Response("ok")) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.fetch = realFetch;
});


/** Let React settle between timer steps (act flushes state only at its end). */
async function settle(ms: number) {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms / 4);
    });
  }
}

describe("ActivityBar", () => {
  it("stays out of the way for instant work and shows for slow work", async () => {
    render(<ActivityBar />);
    let done!: () => void;
    act(() => {
      done = beginActivity();
    });
    await settle(100);
    act(() => done());
    await settle(500);
    expect(screen.queryByRole("progressbar")).toBeNull();

    act(() => {
      done = beginActivity();
    });
    await settle(200);
    expect(screen.getByRole("progressbar", { name: "Loading" })).toHaveAttribute("aria-busy", "true");
    act(() => done());
    await settle(800);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("switches the visible bar on the instant work starts — no render needed", async () => {
    render(<ActivityBar />);
    await settle(20);
    const root = document.documentElement;
    const done = beginActivity(); // deliberately outside act(): no React flush
    expect(root.hasAttribute("data-md-busy")).toBe(true);
    await settle(400);
    done();
    expect(root.hasAttribute("data-md-busy")).toBe(false);
    // It had been on screen, so it runs to the end and fades.
    expect(root.hasAttribute("data-md-done")).toBe(true);
    await settle(600);
    expect(root.hasAttribute("data-md-done")).toBe(false);
  });

  it("replays a tap that landed before the app had started", async () => {
    const button = document.createElement("button");
    const onClick = vi.fn();
    button.addEventListener("click", onClick);
    document.body.appendChild(button);
    window.__mdTap = { el: button, at: Date.now() };
    document.documentElement.setAttribute("data-md-wait", "1");

    render(<ActivityBar />);
    await settle(10);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(document.documentElement.hasAttribute("data-md-wait")).toBe(false);
    expect(window.__mdHydrated).toBe(true);
    button.remove();
  });

  it("lights up for a save the user tapped, not for a background refresh", async () => {
    render(<ActivityBar />);
    let resolve!: (r: Response) => void;
    const pending = new Promise<Response>((r) => (resolve = r));
    // The patched fetch wraps whatever fetch was in place when it mounted.
    const inner = vi.fn(() => pending);
    window.__mdFetchPatched = false;
    window.fetch = inner as unknown as typeof fetch;
    cleanup();
    render(<ActivityBar />);

    // Background: no gesture → no bar.
    act(() => {
      void window.fetch("/admin/orders", { method: "POST", headers: { "Next-Action": "x" } });
    });
    await settle(300);
    expect(screen.queryByRole("progressbar")).toBeNull();

    // Right after a tap → bar.
    act(() => {
      markGesture();
      void window.fetch("/admin/orders", { method: "POST", headers: { "Next-Action": "x" } });
    });
    await settle(300);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    resolve(new Response("ok"));
    await settle(600);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
