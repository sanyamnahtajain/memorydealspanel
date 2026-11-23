/**
 * Seasonal decorations stay decoration: nothing out of season, nothing that
 * can take a tap or reach a screen reader, and no snowfall for people who
 * asked for less motion.
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { NO_SEASON, type Season } from "@/lib/seasonal";
import { AdminSeasonScope, SeasonProvider } from "./SeasonProvider";
import { Snowfall } from "./Snowfall";
import { FairyLights, LogoWinterDecor, SnowDrift, WinterScene } from "./WinterDecor";

const WINTER: Season = { winter: true, snow: "light", christmas: true, admin: false, sounds: false };

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (q: string) =>
      ({
        matches: reduce && q.includes("reduce"),
        media: q,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-reduce-motion");
});

const all = (
  <>
    <Snowfall />
    <SnowDrift variant="hang" icicles />
    <SnowDrift variant="pile" />
    <LogoWinterDecor />
    <FairyLights />
    <WinterScene />
  </>
);

describe("seasonal decor", () => {
  it("renders nothing at all out of season", () => {
    setReducedMotion(false);
    const { container } = render(<SeasonProvider season={NO_SEASON}>{all}</SeasonProvider>);
    expect(container.innerHTML).toBe("");
  });

  it("in season: every piece is aria-hidden and ignores the pointer", () => {
    setReducedMotion(false);
    const { container } = render(<SeasonProvider season={WINTER}>{all}</SeasonProvider>);
    const top = [...container.children] as HTMLElement[];
    expect(top.length).toBeGreaterThanOrEqual(6);
    for (const el of top) {
      expect(el.getAttribute("aria-hidden")).toBe("true");
      expect(el.getAttribute("class") ?? "").toContain("pointer-events-none");
    }
    // the snowfall sits BEHIND the content
    expect(container.querySelector(".md-snow")?.className).toContain("-z-10");
    expect(container.querySelectorAll(".md-flake").length).toBeGreaterThan(0);
  });

  it("no snowfall for 'reduce motion' — system or in-app", () => {
    setReducedMotion(true);
    const a = render(<SeasonProvider season={WINTER}><Snowfall /></SeasonProvider>);
    expect(a.container.querySelector(".md-snow")).toBeNull();
    cleanup();

    setReducedMotion(false);
    document.documentElement.setAttribute("data-reduce-motion", "true");
    const b = render(<SeasonProvider season={WINTER}><Snowfall /></SeasonProvider>);
    expect(b.container.querySelector(".md-snow")).toBeNull();
  });

  it("the admin console is decorated only when the owner allows it", () => {
    setReducedMotion(false);
    const off = render(
      <SeasonProvider season={WINTER}>
        <AdminSeasonScope>
          <LogoWinterDecor />
        </AdminSeasonScope>
      </SeasonProvider>,
    );
    expect(off.container.innerHTML).toBe("");
    cleanup();
    const on = render(
      <SeasonProvider season={{ ...WINTER, admin: true }}>
        <AdminSeasonScope>
          <LogoWinterDecor />
        </AdminSeasonScope>
      </SeasonProvider>,
    );
    expect(on.container.querySelector(".md-santa-hat")).not.toBeNull();
  });

  it("without Christmas touches the logo gets a snow cap, and no lights", () => {
    setReducedMotion(false);
    const { container } = render(
      <SeasonProvider season={{ ...WINTER, christmas: false }}>
        <LogoWinterDecor />
        <FairyLights />
      </SeasonProvider>,
    );
    expect(container.querySelector(".md-santa-hat")).toBeNull();
    expect(container.querySelector(".md-fairy-lights")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
