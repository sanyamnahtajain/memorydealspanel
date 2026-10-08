import { describe, expect, it } from "vitest";

import { titleCase } from "./display-case";

describe("titleCase", () => {
  it("normalises ALL CAPS, lower case and Title Case to one treatment", () => {
    expect(titleCase("MOBILE COVERS")).toBe("Mobile Covers");
    expect(titleCase("mobile covers")).toBe("Mobile Covers");
    expect(titleCase("Mobile Covers")).toBe("Mobile Covers");
  });

  it("keeps known acronyms upper even in a shouted string", () => {
    expect(titleCase("USB CABLES")).toBe("USB Cables");
    expect(titleCase("OTG ADAPTERS")).toBe("OTG Adapters");
    expect(titleCase("TWS")).toBe("TWS");
    expect(titleCase("JBL")).toBe("JBL");
    expect(titleCase("PD CAR CHARGER")).toBe("PD Car Charger");
  });

  it("treats short tokens in a shouted string as words, not acronyms", () => {
    expect(titleCase("CAR CHARGERS")).toBe("Car Chargers");
    expect(titleCase("PEN DRIVES")).toBe("Pen Drives");
    expect(titleCase("KEY CHAINS")).toBe("Key Chains");
  });

  it("keeps a deliberately upper-cased short token in a mixed-case string", () => {
    expect(titleCase("ZTE Routers")).toBe("ZTE Routers");
    expect(titleCase("BT Speakers")).toBe("BT Speakers");
  });

  it("keeps known longer acronyms upper-case", () => {
    expect(titleCase("HDMI CABLES")).toBe("HDMI Cables");
    expect(titleCase("amoled screen guards")).toBe("AMOLED Screen Guards");
  });

  it("leaves tokens with digits alone", () => {
    expect(titleCase("20W FAST CHARGER")).toBe("20W Fast Charger");
    expect(titleCase("3D TEMPERED GLASS")).toBe("3D Tempered Glass");
  });

  it("respects author-intended mixed case", () => {
    expect(titleCase("iPhone Cases")).toBe("iPhone Cases");
    expect(titleCase("boAt")).toBe("boAt");
    expect(titleCase("JioFi ROUTERS")).toBe("JioFi Routers");
  });

  it("splits on hyphens, slashes, ampersands and plus signs", () => {
    expect(titleCase("TYPE-C CABLES")).toBe("Type-C Cables");
    expect(titleCase("CASES & COVERS")).toBe("Cases & Covers");
    expect(titleCase("EARPHONES/HEADPHONES")).toBe("Earphones/Headphones");
    expect(titleCase("CHARGER+CABLE COMBO")).toBe("Charger+Cable Combo");
  });

  it("lower-cases small joining words except at the start", () => {
    expect(titleCase("CHARGERS AND ADAPTERS")).toBe("Chargers and Adapters");
    expect(titleCase("THE MEMORY DEALS")).toBe("The Memory Deals");
    expect(titleCase("CAR ACCESSORIES FOR THE ROAD")).toBe(
      "Car Accessories for the Road",
    );
  });

  it("collapses whitespace and trims", () => {
    expect(titleCase("  POWER   BANKS ")).toBe("Power Banks");
  });

  it("handles empty and nullish input", () => {
    expect(titleCase("")).toBe("");
    expect(titleCase("   ")).toBe("");
    expect(titleCase(null)).toBe("");
    expect(titleCase(undefined)).toBe("");
  });

  it("brand names", () => {
    expect(titleCase("SAMSUNG")).toBe("Samsung");
    expect(titleCase("realme")).toBe("Realme");
    expect(titleCase("MI")).toBe("MI");
  });
});
