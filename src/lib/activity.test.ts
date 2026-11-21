// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  GESTURE_WINDOW_MS,
  _resetActivityForTests,
  activityCount,
  beginActivity,
  classifyRequest,
  isInternalNavigationClick,
  markGesture,
  recentGesture,
  subscribeActivity,
} from "./activity";

const here = { origin: "https://shop.test", pathname: "/c/chargers", search: "" };

afterEach(() => _resetActivityForTests());

describe("classifyRequest", () => {
  it("a page load to another page is a navigation", () => {
    expect(classifyRequest("/p/charger-20w?_rsc=abc", { headers: { RSC: "1" } }, here)).toBe("navigation");
    expect(classifyRequest("/c/chargers?brand=ambrane&_rsc=x", { headers: { rsc: "1" } }, here)).toBe("navigation");
  });

  it("a refresh of the page you are on is an action, not a navigation", () => {
    expect(classifyRequest("/c/chargers?_rsc=abc", { headers: { RSC: "1" } }, here)).toBe("action");
  });

  it("server actions and writes are actions", () => {
    expect(classifyRequest("/c/chargers", { method: "POST", headers: { "Next-Action": "abc" } }, here)).toBe("action");
    expect(classifyRequest("/api/cart", { method: "PATCH" }, here)).toBe("action");
  });

  it("prefetches, plain reads, other sites and the error beacon are ignored", () => {
    expect(classifyRequest("/p/x?_rsc=1", { headers: { RSC: "1", "Next-Router-Prefetch": "1" } }, here)).toBeNull();
    expect(classifyRequest("/api/me/context", undefined, here)).toBeNull();
    expect(classifyRequest("https://cdn.other.test/a.jpg", { method: "POST" }, here)).toBeNull();
    expect(classifyRequest("/api/client-log", { method: "POST" }, here)).toBeNull();
  });

  it("reads headers from a Request object too", () => {
    const req = new Request("https://shop.test/p/y", { headers: { RSC: "1" } });
    expect(classifyRequest(req, undefined, here)).toBe("navigation");
  });
});

describe("isInternalNavigationClick", () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  function a(href: string, attrs: Record<string, string> = {}) {
    const el = document.createElement("a");
    el.setAttribute("href", href);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  it("is true for a plain tap on another page of this shop", () => {
    expect(isInternalNavigationClick(a("/p/charger"), click, here)).toBe(true);
    expect(isInternalNavigationClick(a("/c/chargers?brand=x"), click, here)).toBe(true);
  });

  it("is false for the page you are on, new tabs, downloads, other sites and phone links", () => {
    expect(isInternalNavigationClick(a("/c/chargers"), click, here)).toBe(false);
    expect(isInternalNavigationClick(a("#top"), click, here)).toBe(false);
    expect(isInternalNavigationClick(a("/p/x", { target: "_blank" }), click, here)).toBe(false);
    expect(isInternalNavigationClick(a("/catalog.pdf", { download: "" }), click, here)).toBe(false);
    expect(isInternalNavigationClick(a("https://wa.me/91999"), click, here)).toBe(false);
    expect(isInternalNavigationClick(a("tel:+9199"), click, here)).toBe(false);
    expect(isInternalNavigationClick(a("/p/x"), { ...click, metaKey: true }, here)).toBe(false);
    expect(isInternalNavigationClick(a("/p/x"), { ...click, button: 1 }, here)).toBe(false);
  });
});

describe("activity counter", () => {
  it("counts overlapping work and tolerates a double done", () => {
    let calls = 0;
    subscribeActivity(() => calls++);
    const a = beginActivity();
    const b = beginActivity();
    expect(activityCount()).toBe(2);
    a();
    a();
    expect(activityCount()).toBe(1);
    b();
    expect(activityCount()).toBe(0);
    expect(calls).toBe(4);
  });

  it("only treats requests right after a tap as user-started", () => {
    markGesture(1_000);
    expect(recentGesture(1_000 + GESTURE_WINDOW_MS)).toBe(true);
    expect(recentGesture(1_001 + GESTURE_WINDOW_MS)).toBe(false);
  });
});
