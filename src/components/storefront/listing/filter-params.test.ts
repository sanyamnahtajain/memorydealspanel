import { describe, expect, it } from "vitest";

import {
  CONTEXT_FILTER_PARAMS,
  isObjectId,
  parseListParam,
  parseStockParam,
  toggleListValue,
  writeListParam,
} from "./filter-params";

describe("parseListParam", () => {
  it("reads a comma-joined value", () => {
    const p = new URLSearchParams("brand=a,b,c");
    expect(parseListParam(p, "brand")).toEqual(["a", "b", "c"]);
  });

  it("reads repeated params AND commas together, trimmed", () => {
    const p = new URLSearchParams();
    p.append("brand", "a, b");
    p.append("brand", "c");
    expect(parseListParam(p, "brand")).toEqual(["a", "b", "c"]);
  });

  it("dedupes and drops empty segments", () => {
    const p = new URLSearchParams("brand=a,,a,%20,b");
    expect(parseListParam(p, "brand")).toEqual(["a", "b"]);
  });

  it("returns [] when the param is absent", () => {
    expect(parseListParam(new URLSearchParams(), "brand")).toEqual([]);
  });
});

describe("writeListParam", () => {
  it("writes a comma-joined value and preserves unrelated params", () => {
    const p = new URLSearchParams("sort=name&view=grid");
    writeListParam(p, "brand", ["a", "b"]);
    expect(p.get("brand")).toBe("a,b");
    expect(p.get("sort")).toBe("name");
    expect(p.get("view")).toBe("grid");
  });

  it("REMOVES the key for an empty selection (clean URLs stay clean)", () => {
    const p = new URLSearchParams("brand=a,b&sort=name");
    writeListParam(p, "brand", []);
    expect(p.has("brand")).toBe(false);
    expect(p.get("sort")).toBe("name");
  });

  it("dedupes and drops blank values before writing", () => {
    const p = new URLSearchParams();
    writeListParam(p, "cat", ["x", " x ", "", "y"]);
    expect(p.get("cat")).toBe("x,y");
  });

  it("round-trips through parseListParam", () => {
    const p = new URLSearchParams();
    writeListParam(p, "brand", ["one", "two"]);
    expect(parseListParam(p, "brand")).toEqual(["one", "two"]);
  });
});

describe("toggleListValue", () => {
  it("adds when next=true and absent", () => {
    expect(toggleListValue(["a"], "b", true)).toEqual(["a", "b"]);
  });
  it("removes when next=false and present", () => {
    expect(toggleListValue(["a", "b"], "a", false)).toEqual(["b"]);
  });
  it("is a no-op (copy) when already in the desired state", () => {
    expect(toggleListValue(["a"], "a", true)).toEqual(["a"]);
    expect(toggleListValue(["a"], "b", false)).toEqual(["a"]);
  });
});

describe("isObjectId", () => {
  it("accepts 24-char hex ids", () => {
    expect(isObjectId("64b7f0c2a1d2e3f4a5b6c7d8")).toBe(true);
    expect(isObjectId("ABCDEFabcdef012345678901")).toBe(true);
  });
  it("rejects junk that would make Prisma's ObjectId filter throw", () => {
    expect(isObjectId("zebronics")).toBe(false);
    expect(isObjectId("")).toBe(false);
    expect(isObjectId("64b7f0c2a1d2e3f4a5b6c7d")).toBe(false); // 23 chars
    expect(isObjectId("64b7f0c2a1d2e3f4a5b6c7d8x")).toBe(false); // 25 chars
    expect(isObjectId("64b7f0c2-1d2e3f4a5b6c7d8")).toBe(false); // non-hex
  });
});

describe("parseStockParam", () => {
  it("keeps only valid statuses", () => {
    const p = new URLSearchParams(
      `${CONTEXT_FILTER_PARAMS.stock}=IN_STOCK,BOGUS,LOW`,
    );
    expect(parseStockParam(p)).toEqual(["IN_STOCK", "LOW"]);
  });
  it("returns [] when absent", () => {
    expect(parseStockParam(new URLSearchParams())).toEqual([]);
  });
});
