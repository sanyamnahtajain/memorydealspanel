import { describe, expect, it } from "vitest";

import {
  isValidTrackingUrl,
  parseStoredTracking,
  trackingInputSchema,
  trackingPushBody,
  trackingSummary,
} from "./tracking";

describe("isValidTrackingUrl", () => {
  it("accepts a plausible https address", () => {
    expect(isValidTrackingUrl("https://www.bluedart.com/track?awb=123")).toBe(true);
    expect(isValidTrackingUrl("https://track.delhivery.com/p/ABC")).toBe(true);
  });

  it("rejects http, other schemes, and implausible hosts", () => {
    expect(isValidTrackingUrl("http://bluedart.com/track")).toBe(false);
    expect(isValidTrackingUrl("javascript:alert(1)")).toBe(false);
    expect(isValidTrackingUrl("ftp://bluedart.com")).toBe(false);
    expect(isValidTrackingUrl("bluedart.com/track")).toBe(false); // not absolute
    expect(isValidTrackingUrl("https://localhost/track")).toBe(false); // no dot
    expect(isValidTrackingUrl("")).toBe(false);
    expect(isValidTrackingUrl(`https://a.com/${"x".repeat(3000)}`)).toBe(false);
  });
});

describe("trackingInputSchema", () => {
  it("requires at least one of trackingId / url", () => {
    expect(trackingInputSchema.safeParse({}).success).toBe(false);
    expect(
      trackingInputSchema.safeParse({ courierName: "Bluedart" }).success,
    ).toBe(false);
    expect(
      trackingInputSchema.safeParse({ courierName: "", trackingId: "  " }).success,
    ).toBe(false);
    expect(trackingInputSchema.safeParse({ trackingId: "AWB1" }).success).toBe(true);
    expect(
      trackingInputSchema.safeParse({ url: "https://a.com/t" }).success,
    ).toBe(true);
  });

  it("collapses empty strings to undefined and trims", () => {
    const parsed = trackingInputSchema.parse({
      courierName: "  Bluedart  ",
      trackingId: " AWB123 ",
      url: "",
    });
    expect(parsed).toEqual({
      courierName: "Bluedart",
      trackingId: "AWB123",
      url: undefined,
    });
  });

  it("enforces https on the link", () => {
    expect(
      trackingInputSchema.safeParse({ url: "http://bluedart.com/t" }).success,
    ).toBe(false);
    expect(
      trackingInputSchema.safeParse({ url: "not a url", trackingId: "A" }).success,
    ).toBe(false);
  });

  it("enforces the length caps", () => {
    expect(
      trackingInputSchema.safeParse({ courierName: "c".repeat(61), trackingId: "A" })
        .success,
    ).toBe(false);
    expect(
      trackingInputSchema.safeParse({ trackingId: "t".repeat(65) }).success,
    ).toBe(false);
    expect(
      trackingInputSchema.safeParse({ trackingId: "t".repeat(64) }).success,
    ).toBe(true);
  });
});

describe("parseStoredTracking", () => {
  it("tolerates junk → null (frozen-order safety)", () => {
    for (const junk of [
      null,
      undefined,
      "string",
      42,
      true,
      [],
      ["a"],
      {},
      { courierName: "Bluedart" }, // nothing trackable
      { trackingId: 123, url: {} },
      { trackingId: "", url: "   " },
      { trackingId: "x".repeat(65) }, // over-cap → dropped → nothing left
    ]) {
      expect(parseStoredTracking(junk)).toBeNull();
    }
  });

  it("drops a non-https stored url but keeps the rest", () => {
    expect(
      parseStoredTracking({ trackingId: "AWB1", url: "http://evil.com" }),
    ).toEqual({ courierName: null, trackingId: "AWB1", url: null });
    // A bad url with nothing else trackable → null.
    expect(parseStoredTracking({ url: "javascript:alert(1)" })).toBeNull();
  });

  it("round-trips what the input schema writes", () => {
    const written = trackingInputSchema.parse({
      courierName: "Bluedart",
      trackingId: "AWB123",
      url: "https://www.bluedart.com/track?awb=AWB123",
    });
    // Store shape is the schema output (undefined fields dropped by JSON).
    const stored = JSON.parse(JSON.stringify(written)) as unknown;
    expect(parseStoredTracking(stored)).toEqual({
      courierName: "Bluedart",
      trackingId: "AWB123",
      url: "https://www.bluedart.com/track?awb=AWB123",
    });

    const idOnly = JSON.parse(
      JSON.stringify(trackingInputSchema.parse({ trackingId: "AWB9" })),
    ) as unknown;
    expect(parseStoredTracking(idOnly)).toEqual({
      courierName: null,
      trackingId: "AWB9",
      url: null,
    });
  });
});

describe("display helpers", () => {
  it("trackingSummary prefers courier · id", () => {
    expect(
      trackingSummary({ courierName: "Bluedart", trackingId: "A1", url: null }),
    ).toBe("Bluedart · A1");
    expect(
      trackingSummary({ courierName: null, trackingId: "A1", url: null }),
    ).toBe("A1");
    expect(
      trackingSummary({ courierName: "DTDC", trackingId: null, url: "https://a.com/x" }),
    ).toBe("DTDC");
    expect(
      trackingSummary({ courierName: null, trackingId: null, url: "https://a.com/x" }),
    ).toBe("Tracking link");
  });

  it("trackingPushBody stays in simple English", () => {
    expect(
      trackingPushBody({ courierName: "Bluedart", trackingId: "A1", url: null }),
    ).toBe("Sent with Bluedart. Tracking number: A1. Tap to see your order.");
    expect(
      trackingPushBody({ courierName: null, trackingId: null, url: "https://a.com/x" }),
    ).toBe("Tap to see your order.");
  });
});
