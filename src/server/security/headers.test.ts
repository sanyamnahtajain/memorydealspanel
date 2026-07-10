import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  securityHeaders,
} from "./headers";

function csp(headers: ReturnType<typeof securityHeaders>): string {
  return headers.find((h) => h.key === "Content-Security-Policy")!.value;
}

describe("buildContentSecurityPolicy", () => {
  const original = process.env.R2_PUBLIC_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.R2_PUBLIC_URL;
    else process.env.R2_PUBLIC_URL = original;
  });

  it("always allows self and Turnstile for scripts and frames", () => {
    delete process.env.R2_PUBLIC_URL;
    const value = buildContentSecurityPolicy(false);
    expect(value).toContain("default-src 'self'");
    expect(value).toContain("https://challenges.cloudflare.com");
    expect(value).toContain("frame-src https://challenges.cloudflare.com");
    expect(value).toContain("frame-ancestors 'none'");
    expect(value).toContain("object-src 'none'");
  });

  it("includes the R2 public origin (origin only) in img-src and connect-src", () => {
    process.env.R2_PUBLIC_URL = "https://images.memorydeals.com/some/path";
    const value = buildContentSecurityPolicy(false);
    // Only the origin, never the path.
    expect(value).toContain("https://images.memorydeals.com");
    expect(value).not.toContain("/some/path");
    const imgSrc = value
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("img-src"))!;
    expect(imgSrc).toContain("https://images.memorydeals.com");
  });

  it("fails closed on a malformed R2_PUBLIC_URL", () => {
    process.env.R2_PUBLIC_URL = "not a url";
    const value = buildContentSecurityPolicy(false);
    expect(value).not.toContain("not a url");
  });

  it("does not grant unsafe-eval to scripts in production", () => {
    delete process.env.R2_PUBLIC_URL;
    const value = buildContentSecurityPolicy(false);
    const scriptSrc = value
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("script-src"))!;
    expect(scriptSrc).not.toContain("unsafe-eval");
    expect(value).toContain("upgrade-insecure-requests");
  });

  it("relaxes for dev (eval + websockets) and drops upgrade-insecure-requests", () => {
    delete process.env.R2_PUBLIC_URL;
    const value = buildContentSecurityPolicy(true);
    expect(value).toContain("'unsafe-eval'");
    expect(value).toContain("ws:");
    expect(value).not.toContain("upgrade-insecure-requests");
  });
});

describe("securityHeaders", () => {
  const original = process.env.R2_PUBLIC_URL;
  beforeEach(() => {
    delete process.env.R2_PUBLIC_URL;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.R2_PUBLIC_URL;
    else process.env.R2_PUBLIC_URL = original;
  });

  it("sets nosniff, frame-deny and a referrer policy", () => {
    const headers = securityHeaders(false);
    const keyed = Object.fromEntries(headers.map((h) => [h.key, h.value]));
    expect(keyed["X-Content-Type-Options"]).toBe("nosniff");
    expect(keyed["X-Frame-Options"]).toBe("DENY");
    expect(keyed["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("emits HSTS only in production", () => {
    const prod = securityHeaders(false);
    expect(prod.find((h) => h.key === "Strict-Transport-Security")).toBeDefined();
    expect(csp(prod)).toBeTruthy();

    const dev = securityHeaders(true);
    expect(
      dev.find((h) => h.key === "Strict-Transport-Security"),
    ).toBeUndefined();
  });
});
