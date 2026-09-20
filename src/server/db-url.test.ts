import { describe, expect, it } from "vitest";

import { withBoundedTimeouts } from "./db-url";

const params = (url: string) =>
  Object.fromEntries(
    url
      .slice(url.indexOf("?") + 1)
      .split("&")
      .map((pair) => pair.split("=") as [string, string]),
  );

/**
 * A malformed connection string takes the WHOLE shop down (P1013), so this
 * rewrite is tested for what it must never break as much as for what it adds.
 */
describe("withBoundedTimeouts", () => {
  it("adds the timeouts to an Atlas SRV url, keeping what was there", () => {
    const out = withBoundedTimeouts(
      "mongodb+srv://user:p%40ss@cluster0.abc.mongodb.net/memorydeals?retryWrites=true&w=majority",
    )!;
    expect(out.startsWith("mongodb+srv://user:p%40ss@cluster0.abc.mongodb.net/memorydeals?")).toBe(true);
    expect(params(out)).toMatchObject({
      retryWrites: "true",
      w: "majority",
      serverSelectionTimeoutMS: "8000",
      connectTimeoutMS: "8000",
      maxIdleTimeMS: "60000",
    });
  });

  it("never overrides a value the operator set, whatever its casing", () => {
    const out = withBoundedTimeouts(
      "mongodb://h/db?serverselectiontimeoutms=2000&maxIdleTimeMS=5000",
    )!;
    expect(out).toContain("serverselectiontimeoutms=2000");
    expect(out).toContain("maxIdleTimeMS=5000");
    expect(out.match(/serverselectiontimeoutms/gi)).toHaveLength(1);
    expect(out.match(/maxidletimems/gi)).toHaveLength(1);
    expect(out).toContain("connectTimeoutMS=8000");
  });

  it("handles a url with no query string", () => {
    expect(withBoundedTimeouts("mongodb://127.0.0.1:27018/memorydeals")).toBe(
      "mongodb://127.0.0.1:27018/memorydeals?serverSelectionTimeoutMS=8000&connectTimeoutMS=8000&maxIdleTimeMS=60000",
    );
  });

  it("handles a replica-set url with several hosts", () => {
    const out = withBoundedTimeouts("mongodb://a:1,b:2,c:3/db?replicaSet=rs0")!;
    expect(out.startsWith("mongodb://a:1,b:2,c:3/db?replicaSet=rs0&")).toBe(true);
  });

  it("keeps a url with no database path valid", () => {
    expect(withBoundedTimeouts("mongodb://h:27017")).toMatch(
      /^mongodb:\/\/h:27017\/\?serverSelectionTimeoutMS=8000/,
    );
  });

  it("leaves everything else exactly alone", () => {
    expect(withBoundedTimeouts(undefined)).toBeUndefined();
    expect(withBoundedTimeouts("")).toBe("");
    expect(withBoundedTimeouts("postgresql://u@h/db")).toBe("postgresql://u@h/db");
    const already =
      "mongodb://h/db?serverSelectionTimeoutMS=1&connectTimeoutMS=2&maxIdleTimeMS=3";
    expect(withBoundedTimeouts(already)).toBe(already);
  });
});
