// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { _resetScrollLockForTests, healBodyScroll, lockBodyScroll } from "./scroll-lock";

afterEach(() => {
  _resetScrollLockForTests();
  document.body.style.overflow = "";
});

describe("lockBodyScroll", () => {
  it("restores the page only when the LAST lock is released, in any order", () => {
    // The live bug: splash locks, search opens over it, splash finishes first.
    const splash = lockBodyScroll();
    const search = lockBodyScroll();
    splash();
    expect(document.body.style.overflow).toBe("hidden");
    search();
    expect(document.body.style.overflow).toBe("");
  });

  it("ignores a double release", () => {
    const a = lockBodyScroll();
    const b = lockBodyScroll();
    a();
    a();
    expect(document.body.style.overflow).toBe("hidden");
    b();
    expect(document.body.style.overflow).toBe("");
  });
});

describe("healBodyScroll", () => {
  it("unfreezes a page that nothing is holding", () => {
    document.body.style.overflow = "hidden"; // left behind by someone
    healBodyScroll();
    expect(document.body.style.overflow).toBe("");
  });

  it("leaves a real lock alone", () => {
    const release = lockBodyScroll();
    healBodyScroll();
    expect(document.body.style.overflow).toBe("hidden");
    release();
  });
});

describe("guard", () => {
  it("nothing outside scroll-lock.ts writes document.body.style.overflow", () => {
    const root = join(__dirname, "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name) && !path.endsWith("scroll-lock.ts")) {
          if (/document\.body\.style\.overflow\s*=[^=]/.test(readFileSync(path, "utf8"))) offenders.push(path);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
