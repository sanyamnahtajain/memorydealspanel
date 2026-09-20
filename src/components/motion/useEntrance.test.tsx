import * as React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { cleanup, render } from "@testing-library/react";

import { HomeSections } from "@/components/storefront/HomeSections";
import { FadeUp, Stagger } from "@/components/motion/primitives";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

afterEach(cleanup);

/**
 * THE INCIDENT THESE GUARD: entrance animations serialised `opacity:0` into
 * the server-rendered HTML, so the home page's sections and every product grid
 * arrived in the browser INVISIBLE until JavaScript had loaded and run. On a
 * slow phone or a stalled stream, customers saw a banner and a blank page —
 * content that had been delivered, then hidden by its own entrance effect.
 *
 * The server render is the contract: no script may be needed to SEE content.
 */
describe("entrance animations never hide server-rendered content", () => {
  it("HomeSections server-renders its sections visible", () => {
    const html = renderToString(
      <HomeSections>
        <section>Shop by brand</section>
        <section>Best sellers</section>
      </HomeSections>,
    );
    expect(html).toContain("Shop by brand");
    expect(html).not.toMatch(/opacity:\s*0/);
  });

  it("Stagger server-renders its children visible", () => {
    const html = renderToString(
      <Stagger>
        <div>one</div>
        <div>two</div>
      </Stagger>,
    );
    expect(html).not.toMatch(/opacity:\s*0/);
  });

  it("FadeUp server-renders its content visible", () => {
    const html = renderToString(<FadeUp>hello</FadeUp>);
    expect(html).not.toMatch(/opacity:\s*0/);
  });

  it("still animates in when mounted on the client (in-app navigation)", () => {
    // A client-side mount IS allowed to start hidden: JavaScript is running,
    // so the animation is guaranteed to play.
    const { container } = render(
      <HomeSections>
        <section>Shop by brand</section>
      </HomeSections>,
    );
    const item = container.querySelector("section")?.parentElement;
    expect(item?.getAttribute("style") ?? "").toMatch(/opacity:\s*0/);
  });
});
