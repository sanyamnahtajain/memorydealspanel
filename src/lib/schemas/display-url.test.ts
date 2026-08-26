import { describe, expect, it } from "vitest";

import { displayUrlSchema } from "./display-url";

const schema = displayUrlSchema("bad url");

describe("displayUrlSchema", () => {
  it("accepts absolute http(s) URLs", () => {
    expect(schema.safeParse("https://cdn.example.com/a.jpg").success).toBe(true);
    expect(schema.safeParse("http://localhost:3010/a.png").success).toBe(true);
  });

  it("accepts root-relative paths (seed/upload images)", () => {
    expect(schema.safeParse("/seed/chargers-1.svg").success).toBe(true);
    expect(schema.safeParse("/uploads/x.webp").success).toBe(true);
  });

  it("rejects javascript: and other schemes", () => {
    expect(schema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(schema.safeParse("data:text/html,hi").success).toBe(false);
    expect(schema.safeParse("ftp://files/x.jpg").success).toBe(false);
  });

  it("rejects protocol-relative and bare strings", () => {
    expect(schema.safeParse("//evil.com/x.jpg").success).toBe(false);
    expect(schema.safeParse("not a url").success).toBe(false);
    expect(schema.safeParse("").success).toBe(false);
  });
});
