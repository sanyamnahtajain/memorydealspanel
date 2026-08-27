import { afterEach, describe, expect, it } from "vitest";

import { isCronAuthorized } from "./cron-auth";

const ORIGINAL = process.env.CRON_SECRET;
afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL;
});

function req(headers: Record<string, string>): Request {
  return new Request("https://example.com/api/cron/backup", { headers });
}

describe("isCronAuthorized", () => {
  it("accepts Vercel's Bearer header", () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect(isCronAuthorized(req({ authorization: "Bearer s3cret-value" }))).toBe(
      true,
    );
  });

  it("accepts the manual x-cron-secret header", () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect(isCronAuthorized(req({ "x-cron-secret": "s3cret-value" }))).toBe(true);
  });

  it("rejects a wrong secret, a wrong scheme and a prefix of the secret", () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect(isCronAuthorized(req({ authorization: "Bearer nope" }))).toBe(false);
    expect(isCronAuthorized(req({ authorization: "Basic s3cret-value" }))).toBe(
      false,
    );
    expect(isCronAuthorized(req({ "x-cron-secret": "s3cret" }))).toBe(false);
    expect(isCronAuthorized(req({}))).toBe(false);
  });

  it("FAILS CLOSED when no secret is configured", () => {
    delete process.env.CRON_SECRET;
    expect(isCronAuthorized(req({ authorization: "Bearer anything" }))).toBe(
      false,
    );
    expect(isCronAuthorized(req({ "x-cron-secret": "" }))).toBe(false);
  });
});
