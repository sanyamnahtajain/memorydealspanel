import { describe, expect, it } from "vitest";

import {
  ENTRY_GATE_OFF,
  entryCodeMatches,
  entryGateSchema,
  normalizeEntryCode,
  parseEntryGate,
} from "./entry-gate";

describe("entry gate — reading the stored config", () => {
  it("is off until the owner configures it", () => {
    expect(parseEntryGate(null)).toEqual(ENTRY_GATE_OFF);
    expect(parseEntryGate(undefined)).toEqual(ENTRY_GATE_OFF);
  });

  it("fails OPEN on junk — a broken row must not lock every new customer out", () => {
    expect(parseEntryGate("nonsense")).toEqual(ENTRY_GATE_OFF);
    expect(parseEntryGate(42)).toEqual(ENTRY_GATE_OFF);
    expect(parseEntryGate({ enabled: "yes", code: 5 })).toEqual(ENTRY_GATE_OFF);
  });

  it("treats enabled-with-no-usable-code as off, not as an unopenable door", () => {
    expect(parseEntryGate({ enabled: true, code: "" })).toEqual(ENTRY_GATE_OFF);
    expect(parseEntryGate({ enabled: true, code: "ab" })).toEqual(ENTRY_GATE_OFF);
  });

  it("round-trips a real config", () => {
    const gate = { enabled: true, code: "TMD2026" };
    expect(parseEntryGate(gate)).toEqual(gate);
  });
});

describe("entry gate — matching a typed code", () => {
  const gate = { enabled: true, code: "TMD2026" };

  it("accepts the code however the phone keyboard mangles it", () => {
    // Read aloud over the phone, typed with auto-capitalise and a stray
    // space — all of these are the same code to a human.
    for (const attempt of ["TMD2026", "tmd2026", " tmd2026 ", "Tmd2026"]) {
      expect(entryCodeMatches(gate, attempt)).toBe(true);
    }
  });

  it("rejects a wrong code", () => {
    expect(entryCodeMatches(gate, "TMD2027")).toBe(false);
    expect(entryCodeMatches(gate, "")).toBe(false);
  });

  it("asks for nothing while the gate is off", () => {
    expect(entryCodeMatches({ enabled: false, code: "TMD2026" }, "anything")).toBe(
      true,
    );
    expect(entryCodeMatches(ENTRY_GATE_OFF, "")).toBe(true);
  });

  it("never matches against an empty stored code", () => {
    // Belt-and-braces: parseEntryGate already turns this state off, but the
    // matcher itself must not treat "" === "" as a pass either.
    expect(entryCodeMatches({ enabled: true, code: "" }, "")).toBe(false);
  });
});

describe("entry gate — the schema the admin saves through", () => {
  it("requires a real code", () => {
    expect(entryGateSchema.safeParse({ enabled: true, code: "abc" }).success).toBe(
      false,
    );
    expect(
      entryGateSchema.safeParse({ enabled: true, code: "abcd" }).success,
    ).toBe(true);
  });

  it("normalises consistently", () => {
    expect(normalizeEntryCode("  tmd 2026  ")).toBe("TMD 2026");
  });
});
