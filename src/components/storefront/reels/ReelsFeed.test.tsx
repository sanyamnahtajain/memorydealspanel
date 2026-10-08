import * as React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ReelsFeed } from "./ReelsFeed";
import type { StorefrontReel } from "@/lib/reels";

// jsdom has no IntersectionObserver, no matchMedia, and HTMLMediaElement's
// play()/pause()/load() throw "not implemented". The feed must still render
// and behave; the stubs below make the environment inert and observable.
class InertObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const play = vi.fn(() => Promise.resolve());
const pause = vi.fn();
// Which layout the (stubbed) `(min-width: 768px)` query reports.
let desktop = false;

beforeAll(() => {
  for (const target of [window, globalThis]) {
    Object.defineProperty(target, "IntersectionObserver", { writable: true, value: InertObserver });
    Object.defineProperty(target, "ResizeObserver", { writable: true, value: InertObserver });
  }
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("min-width") ? desktop : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: play });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: pause });
  Object.defineProperty(HTMLMediaElement.prototype, "load", { configurable: true, value: () => {} });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: () => {} });
});

beforeEach(() => {
  desktop = false;
  play.mockClear();
  pause.mockClear();
  window.history.replaceState({}, "", "/reels");
  try {
    window.localStorage.clear();
    // The sound store reads storage first; pin the default so test order
    // cannot leak one test's unmute into the next.
    window.localStorage.setItem("md:reels:muted", "1");
  } catch {
    /* ignore */
  }
});

afterEach(cleanup);

function reel(id: string, overrides: Partial<StorefrontReel> = {}): StorefrontReel {
  return {
    id,
    videoUrl: `https://cdn.example.test/reels/${id}.mp4`,
    posterUrl: `https://cdn.example.test/reels/${id}.jpg`,
    caption: `Clip ${id} — a short caption about new stock`,
    instagramUrl: null,
    durationSec: 12,
    product: null,
    ...overrides,
  };
}

const reels = [
  reel("r1", {
    product: { id: "p1", slug: "boat-rockerz", name: "boAt Rockerz 450", imageUrl: "https://cdn.example.test/p1.jpg" },
  }),
  reel("r2", { instagramUrl: "https://www.instagram.com/reel/abc/" }),
  reel("r3"),
];

/** The phone feed's items — the desktop stage renders one player separately. */
function phoneItems() {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-reel-item]"));
}
function phoneVideos() {
  return Array.from(document.querySelectorAll<HTMLVideoElement>("[data-reel-item] video"));
}
function stageVideo() {
  return document.querySelector<HTMLVideoElement>('section[aria-label="Reels"] video');
}

describe("ReelsFeed", () => {
  it("renders nothing for an empty feed", () => {
    const { container } = render(<ReelsFeed reels={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders every reel in the phone feed and starts on the first", () => {
    render(<ReelsFeed reels={reels} />);
    const items = phoneItems();
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveAttribute("data-active", "true");
    expect(items[1]).not.toHaveAttribute("data-active");
    // Positions are announced for a screen reader walking the feed.
    expect(items[2]).toHaveAttribute("aria-label", "Reel 3 of 3");
  });

  it("starts at the reel named by ?r=", () => {
    window.history.replaceState({}, "", "/reels?r=r2");
    render(<ReelsFeed reels={reels} />);
    const items = phoneItems();
    expect(items[1]).toHaveAttribute("data-active", "true");
    expect(items[0]).not.toHaveAttribute("data-active");
    // The desktop stage shows the same clip.
    expect(screen.getByText(/reel 2 of 3/i)).toBeInTheDocument();
  });

  it("ignores an unknown ?r=", () => {
    window.history.replaceState({}, "", "/reels?r=nope");
    render(<ReelsFeed reels={reels} />);
    expect(phoneItems()[0]).toHaveAttribute("data-active", "true");
  });

  it("never carries a price", () => {
    const { container } = render(<ReelsFeed reels={reels} />);
    expect(container.textContent).not.toMatch(/₹|\bRs\.?\b|\bMRP\b/i);
    // but the product is shoppable by name
    expect(screen.getAllByText("boAt Rockerz 450").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /boAt Rockerz 450/i })[0]).toHaveAttribute(
      "href",
      "/p/boat-rockerz",
    );
  });

  it("starts muted, toggles, and remembers the choice", () => {
    render(<ReelsFeed reels={reels} />);
    const unmute = screen.getAllByRole("button", { name: "Unmute" });
    expect(unmute.length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("button", { name: "Mute" })).toHaveLength(0);

    fireEvent.click(unmute[0]);

    // Every player follows the one shared choice.
    expect(screen.queryAllByRole("button", { name: "Unmute" })).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "Mute" }).length).toBeGreaterThan(0);
    expect(window.localStorage.getItem("md:reels:muted")).toBe("0");
    expect(document.querySelectorAll("video").length).toBeGreaterThan(0);
    document.querySelectorAll("video").forEach((video) => expect(video.muted).toBe(false));
  });

  it("restores a remembered unmuted choice", () => {
    window.localStorage.setItem("md:reels:muted", "0");
    render(<ReelsFeed reels={reels} />);
    expect(screen.getAllByRole("button", { name: "Mute" }).length).toBeGreaterThan(0);
  });

  it("'m' toggles sound from the keyboard", () => {
    render(<ReelsFeed reels={reels} />);
    fireEvent.keyDown(window, { key: "m" });
    expect(screen.getAllByRole("button", { name: "Mute" }).length).toBeGreaterThan(0);
  });

  it("arrow keys move the stage", () => {
    render(<ReelsFeed reels={reels} />);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(phoneItems()[1]).toHaveAttribute("data-active", "true");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" }); // clamps at the end
    expect(phoneItems()[2]).toHaveAttribute("data-active", "true");
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(phoneItems()[1]).toHaveAttribute("data-active", "true");
  });

  it("on a phone only the snap feed's players may fetch — the hidden stage never does", () => {
    render(<ReelsFeed reels={reels} />);
    const [first, second, third] = phoneVideos();
    expect(first).toHaveAttribute("preload", "auto");
    expect(first).toHaveAttribute("autoplay");
    expect(second).toHaveAttribute("preload", "metadata");
    expect(second).not.toHaveAttribute("autoplay");
    expect(third).toHaveAttribute("preload", "none");
    // The desktop stage is display:none here, but preload/autoplay would
    // still download the clip a second time — so it gets neither.
    const stage = stageVideo();
    expect(stage).not.toBeNull();
    expect(stage).toHaveAttribute("preload", "none");
    expect(stage).not.toHaveAttribute("autoplay");
  });

  it("on desktop only the stage may fetch — the hidden phone list never does", () => {
    desktop = true;
    render(<ReelsFeed reels={reels} />);
    const stage = stageVideo();
    expect(stage).toHaveAttribute("preload", "auto");
    expect(stage).toHaveAttribute("autoplay");
    for (const video of phoneVideos()) {
      expect(video).toHaveAttribute("preload", "none");
      expect(video).not.toHaveAttribute("autoplay");
    }
  });

  it("the phone list is positioned so item offsets are list-relative", () => {
    render(<ReelsFeed reels={reels} />);
    expect(screen.getByRole("feed", { name: "Reels" })).toHaveClass("relative");
  });

  it("Space on a focused control is left to that control", () => {
    render(<ReelsFeed reels={reels} />);
    const mute = screen.getAllByRole("button", { name: "Unmute" })[0];
    mute.focus();
    const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    mute.dispatchEvent(event);
    // Not prevented: the browser's own Space → click activation still runs.
    expect(event.defaultPrevented).toBe(false);
    // …whereas Space on the page body is the pause shortcut.
    const bodyEvent = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    document.body.dispatchEvent(bodyEvent);
    expect(bodyEvent.defaultPrevented).toBe(true);
  });

  it("links to Instagram — the reel's own post when it has one", () => {
    window.history.replaceState({}, "", "/reels?r=r2");
    render(<ReelsFeed reels={reels} />);
    const links = screen.getAllByRole("link", { name: /instagram/i });
    const own = links.filter((a) => a.getAttribute("href") === "https://www.instagram.com/reel/abc/");
    expect(own.length).toBeGreaterThan(0);
    own.forEach((a) => {
      expect(a).toHaveAttribute("target", "_blank");
      expect(a).toHaveAttribute("rel", "noopener noreferrer");
    });
  });

  it("falls back to copying the link when the share sheet is unavailable", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    render(<ReelsFeed reels={reels} />);
    const share = screen.getAllByRole("button", { name: /^share$/i })[0];
    await act(async () => {
      fireEvent.click(share);
    });

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/reels?r=r1`);
    await waitFor(() => expect(screen.getAllByText(/link copied/i).length).toBeGreaterThan(0));
  });

  it("prefers the system share sheet when there is one", async () => {
    const shareFn = vi.fn(() => Promise.resolve());
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "share", { configurable: true, value: shareFn });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    render(<ReelsFeed reels={reels} />);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /^share$/i })[0]);
    });

    expect(shareFn).toHaveBeenCalledWith({
      title: reels[0].caption,
      url: `${window.location.origin}/reels?r=r1`,
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("shows the failure state for a clip that cannot play", () => {
    render(<ReelsFeed reels={reels} />);
    const video = document.querySelector("[data-reel-item] video");
    expect(video).not.toBeNull();
    fireEvent.error(video!);
    expect(screen.getByText(/couldn't play this clip/i)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /watch on instagram/i })[0]).toHaveAttribute(
      "href",
      "https://www.instagram.com/the_memory_deals/",
    );
  });
});
