import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENTS,
  NOTE_MAX_CHARS,
  attachmentUrlPrefix,
  sanitizeAttachments,
  sanitizeNote,
} from "./requirement-notes";

/**
 * Requirement notes & photos — the pure limits shared by the cart service,
 * order snapshot and the client editor. The attachment allow-list is the
 * security boundary: only URLs under OUR `order-notes/` storage prefix
 * survive (admins open these and the order PDF embeds them server-side).
 */

const BASE = "https://cdn.example.com";
const PREFIX = `${BASE}/order-notes/`;

describe("sanitizeNote", () => {
  it("trims, bounds and nulls empty input", () => {
    expect(sanitizeNote("  20 × Realme 11  ")).toBe("20 × Realme 11");
    expect(sanitizeNote("   ")).toBeNull();
    expect(sanitizeNote("")).toBeNull();
    expect(sanitizeNote(null)).toBeNull();
    expect(sanitizeNote(42)).toBeNull();
    expect(sanitizeNote("x".repeat(NOTE_MAX_CHARS + 500))).toHaveLength(
      NOTE_MAX_CHARS,
    );
  });
});

describe("sanitizeAttachments (URL allow-list)", () => {
  it("keeps only urls under our order-notes prefix", () => {
    const ours = `${PREFIX}cus1/a.jpg`;
    const out = sanitizeAttachments(
      [
        { url: ours },
        { url: "https://evil.example.com/x.jpg" }, // foreign host
        { url: `${BASE}/products/y.jpg` }, // our host, wrong prefix
        { url: "javascript:alert(1)" },
        "garbage-string-entry-not-under-prefix",
        null,
        7,
        { notUrl: true },
      ],
      BASE,
    );
    expect(out).toEqual([{ url: ours }]);
  });

  it("accepts bare-string entries under the prefix, dedupes, caps the list", () => {
    const urls = Array.from(
      { length: MAX_ATTACHMENTS + 4 },
      (_, i) => `${PREFIX}cus1/p${i}.jpg`,
    );
    const out = sanitizeAttachments([urls[0], { url: urls[0] }, ...urls], BASE);
    expect(out).toHaveLength(MAX_ATTACHMENTS);
    expect(out[0]).toEqual({ url: urls[0] });
    // No duplicates survived.
    expect(new Set(out.map((a) => a.url)).size).toBe(out.length);
  });

  it("returns [] for non-array junk", () => {
    expect(sanitizeAttachments(null, BASE)).toEqual([]);
    expect(sanitizeAttachments("not-an-array", BASE)).toEqual([]);
    expect(sanitizeAttachments({ url: `${PREFIX}a.jpg` }, BASE)).toEqual([]);
  });

  it("prefix builder normalises trailing slashes", () => {
    expect(attachmentUrlPrefix("https://cdn.example.com/")).toBe(PREFIX);
    expect(attachmentUrlPrefix("https://cdn.example.com")).toBe(PREFIX);
  });
});
