import { describe, expect, it } from "vitest";
import { customModelNameSchema } from "./cart";

describe("customModelNameSchema hostile-input probe", () => {
  it("collapses whitespace and control chars", () => {
    expect(customModelNameSchema.parse("  moto\t\n g54  5G  ")).toBe("moto g54 5G");
  });
  it("keeps markup as inert plain text (rendered escaped downstream)", () => {
    expect(customModelNameSchema.parse("<b>x</b>")).toBe("<b>x</b>");
  });
  it("rejects empty and over-length", () => {
    expect(customModelNameSchema.safeParse("   ").success).toBe(false);
    expect(customModelNameSchema.safeParse("x".repeat(200)).success).toBe(false);
  });
});
