import { describe, expect, it } from "vitest";

import {
  parseSlabyBranding,
  SLABY_BRANDING_OFF,
  slabyHref,
  slabyPlacementOn,
} from "./branding";

describe("parseSlabyBranding", () => {
  it("absent / malformed config resolves to everything OFF (safe deploy)", () => {
    for (const bad of [null, undefined, {}, "x", { enabled: "yes" }, { enabled: true }]) {
      const cfg = parseSlabyBranding(bad);
      expect(cfg).toEqual(SLABY_BRANDING_OFF);
      expect(cfg.enabled).toBe(false);
    }
  });

  it("round-trips a valid config", () => {
    const valid = {
      enabled: true,
      placements: {
        login: true,
        requestAccess: false,
        orderSuccess: true,
        footer: true,
        promo: false,
      },
      promoFrequencyDays: 14,
    };
    expect(parseSlabyBranding(valid)).toEqual(valid);
  });
});

describe("slabyPlacementOn", () => {
  it("master switch gates every placement", () => {
    const on = parseSlabyBranding({
      enabled: true,
      placements: { login: true, requestAccess: true, orderSuccess: true, footer: true, promo: true },
      promoFrequencyDays: 7,
    });
    expect(slabyPlacementOn(on, "login")).toBe(true);
    expect(slabyPlacementOn({ ...on, enabled: false }, "login")).toBe(false);
    expect(
      slabyPlacementOn({ ...on, placements: { ...on.placements, login: false } }, "login"),
    ).toBe(false);
  });
});

describe("slabyHref", () => {
  it("tags the placement for attribution", () => {
    expect(slabyHref("footer")).toBe(
      "https://slaby.in/?utm_source=memorydeals&utm_medium=badge&utm_campaign=footer",
    );
  });
});
