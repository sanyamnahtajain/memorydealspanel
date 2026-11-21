import { describe, expect, it } from "vitest";

import { describeProduct, factsFromName, needsDescription, productKind, readableName } from "./product-description";

describe("factsFromName — only what the name states", () => {
  it("reads power, capacity, ports and charging tech", () => {
    expect(factsFromName("AMBRANE RAAP M20 20W GAN CHARGER")).toEqual(["20W output", "GaN technology — compact for its power"]);
    expect(factsFromName("boAt PB300 Lite 10K MAH")).toEqual(["10,000 mAh capacity"]);
    expect(factsFromName("Zebronics 50RI 50000mAh 22.5W Power Bank")).toContain("50,000 mAh capacity");
    expect(factsFromName("ERD UC 302 Type C 1M 3A Cable")).toEqual(["3A current", "1 m length", "Type-C (USB-C)"]);
    expect(factsFromName("Digitek C To L Mic Connector")).toEqual(["USB-C to Lightning"]);
    expect(factsFromName("Portronics Dual Port PD 65W")).toEqual(expect.arrayContaining(["65W output", "Power Delivery (PD) fast charging", "2 charging ports"]));
    expect(factsFromName("Captain Pendrive 16GB")).toEqual(["16GB storage"]);
    expect(factsFromName("Noise Buds ANC BT 5.3 IPX5")).toEqual(expect.arrayContaining(["Active noise cancellation (ANC)", "Bluetooth 5.3", "IPX5 water resistance"]));
  });

  it("invents nothing when the name says nothing", () => {
    expect(factsFromName("realme T110")).toEqual([]);
    expect(factsFromName("Beetal Phone M56")).toEqual([]);
  });
});

describe("productKind", () => {
  it("follows the owner's category, refined by the name only where it narrows it", () => {
    expect(productKind({ category: "Chargers", name: "Portronics Freedom 6 Wireless Charger" }).key).toBe("wireless-charger");
    expect(productKind({ category: "CONNECTORS", name: "Digitek C To C Mic Connector" }).key).toBe("connector");
    expect(productKind({ category: "CAR MOBILE  HOLDER", name: "Magnetic Holder" }).key).toBe("car-holder");
    expect(productKind({ category: "Other Accessories", name: "Casio Calculator DJ-120D" }).key).toBe("calculator");
    expect(productKind({ category: "Other Accessories", name: "Water Pouch" }).key).toBe("accessory");
  });
});

describe("readableName", () => {
  it("tames ALL-CAPS names but keeps model codes and acronyms", () => {
    expect(readableName("ZEBRONICS CAR CHARGER CC48")).toBe("Zebronics Car Charger CC48");
    expect(readableName("AMBRANE RAAP M20 20W GAN CHARGER")).toBe("Ambrane Raap M20 20W GAN Charger");
    expect(readableName("boAt PB300 Lite")).toBe("boAt PB300 Lite");
  });
});

describe("describeProduct", () => {
  it("writes an opening, key points and the wholesale terms", () => {
    const text = describeProduct({ name: "AMBRANE RAAP M20 20W GAN CHARGER", brand: "Ambrane", category: "Chargers", moq: 5, packMultiple: null });
    expect(text).toMatch(/^(The )?Ambrane Raap M20 20W GAN Charger is a wall charger\. /);
    expect(text).toContain("Key points\n• 20W output\n• GaN technology — compact for its power\n• Brand: Ambrane");
    expect(text).toMatch(/Wholesale: minimum order 5 pieces\.$/);
  });

  it("names the brand once, in the brand's own spelling", () => {
    const text = describeProduct({ name: "YO 443", brand: "SOROO", category: "Bluetooth Speakers" });
    expect(text).toMatch(/is a Bluetooth speaker from Soroo\./);
    expect(describeProduct({ name: "boAt PB300 Lite 10K MAH", brand: "BOAT", category: "Power Banks" })).toContain("• Brand: boAt");
    expect(describeProduct({ name: "Water Pouch", brand: "OTHER", category: "Other Accessories" })).not.toContain("Brand:");
  });

  it("never mentions a price or another marketplace", () => {
    const text = describeProduct({ name: "Apple 20W Adapter", brand: "Apple", category: "Chargers", moq: 2 });
    expect(text).not.toMatch(/₹|rs\.?\s?\d|price|amazon|flipkart|meesho/i);
  });

  it("is stable — the same product always gets the same text", () => {
    const input = { name: "realme T200 Lite", brand: "realme", category: "Bluetooth Airpods" };
    expect(describeProduct(input)).toBe(describeProduct(input));
  });
});

describe("describeProduct with verified specs", () => {
  it("lists official specs first and drops name facts they already state", () => {
    const text = describeProduct({
      name: "boAt Airdopes 141 ANC 32dB BT 5.3",
      brand: "BOAT",
      category: "Bluetooth Airpods",
      specs: { Playback: "Up to 42 hours", Bluetooth: "v5.3", ANC: "Up to 32dB", "Water resistance": "IPX5" },
    });
    const points = text.split("Key points\n")[1].split("\n");
    expect(points.slice(0, 4)).toEqual(["• Playback: Up to 42 hours", "• Bluetooth: v5.3", "• ANC: Up to 32dB", "• Water resistance: IPX5"]);
    expect(text).not.toContain("• Bluetooth 5.3");
    expect(text).not.toContain("Active noise cancellation (ANC)");
    expect(text).toContain("• Brand: boAt");
  });

  it("ignores empty or malformed specs", () => {
    const plain = describeProduct({ name: "realme T110", brand: "realme", category: "Bluetooth Airpods" });
    expect(describeProduct({ name: "realme T110", brand: "realme", category: "Bluetooth Airpods", specs: { "": "x", Colour: "" } })).toBe(plain);
    expect(describeProduct({ name: "realme T110", brand: "realme", category: "Bluetooth Airpods", specs: [] as never })).toBe(plain);
  });
});

describe("needsDescription", () => {
  it("fills only empty boxes — owner-written text is never replaced", () => {
    expect(needsDescription(null)).toBe(true);
    expect(needsDescription("   ")).toBe(true);
    expect(needsDescription("ALL IPHONE MODELS ONLY")).toBe(false);
  });
});
