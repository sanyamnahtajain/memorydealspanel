import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { SLABY_BRANDING_OFF } from "@/lib/slaby/branding";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { SlabyBand, isSlabyBandQuietPath } from "./SlabyBand";
import { SlabyBrandingProvider } from "./SlabyBrandingProvider";

const ON = { ...SLABY_BRANDING_OFF, enabled: true };

function renderAt(path: string, config = ON) {
  pathname = path;
  return render(
    <SlabyBrandingProvider config={config}>
      <SlabyBand />
    </SlabyBrandingProvider>,
  );
}

afterEach(cleanup);

describe("SlabyBand", () => {
  it("shows on browsing screens with a band-tagged link", () => {
    renderAt("/b/erd");
    const link = screen.getByRole("link", { name: /runs on Slaby/i });
    expect(link.getAttribute("href")).toBe(
      "https://slaby.in/?utm_source=memorydeals&utm_medium=band&utm_campaign=footer",
    );
  });

  it("stays out of cart, checkout and sign-in", () => {
    for (const path of ["/account/cart", "/account/orders/confirmation", "/account/login", "/gate", "/reels"]) {
      expect(isSlabyBandQuietPath(path)).toBe(true);
    }
    renderAt("/account/cart");
    expect(screen.queryByRole("link", { name: /runs on Slaby/i })).toBeNull();
  });

  it("follows the owner's footer toggle and master switch", () => {
    renderAt("/", { ...ON, placements: { ...ON.placements, footer: false } });
    expect(screen.queryByRole("link", { name: /runs on Slaby/i })).toBeNull();
    cleanup();
    renderAt("/", SLABY_BRANDING_OFF);
    expect(screen.queryByRole("link", { name: /runs on Slaby/i })).toBeNull();
  });
});
