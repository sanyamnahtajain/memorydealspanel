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

  it("allows the R2 S3 upload host(s) in connect-src (presigned direct PUT)", () => {
    const prevAccount = process.env.R2_ACCOUNT_ID;
    const prevBucket = process.env.R2_BUCKET;
    process.env.R2_ACCOUNT_ID = "03f23ad3d88cd7d0737f49dbc426e9ad";
    process.env.R2_BUCKET = "memorydeals-images";
    try {
      const connectSrc = buildContentSecurityPolicy(false)
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("connect-src"))!;
      // Path-style account host AND the virtual-hosted bucket host the AWS SDK
      // emits by default — both must be present or the browser blocks the PUT.
      expect(connectSrc).toContain(
        "https://03f23ad3d88cd7d0737f49dbc426e9ad.r2.cloudflarestorage.com",
      );
      expect(connectSrc).toContain(
        "https://memorydeals-images.03f23ad3d88cd7d0737f49dbc426e9ad.r2.cloudflarestorage.com",
      );
    } finally {
      if (prevAccount === undefined) delete process.env.R2_ACCOUNT_ID;
      else process.env.R2_ACCOUNT_ID = prevAccount;
      if (prevBucket === undefined) delete process.env.R2_BUCKET;
      else process.env.R2_BUCKET = prevBucket;
    }
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

  it("uses a relaxed nonce-free script policy in dev even when a nonce is supplied", () => {
    delete process.env.R2_PUBLIC_URL;
    // Middleware calls buildContentSecurityPolicy(isDev, nonce) with a nonce on
    // EVERY request. In dev, Next/Turbopack can't reliably stamp that nonce onto
    // its bootstrap + chunk scripts, and 'strict-dynamic' disables 'self' — so a
    // nonce'd dev policy blocks the whole app. Dev must fall back to unsafe-inline.
    const value = buildContentSecurityPolicy(true, "abc123");
    const scriptSrc = value
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("script-src"))!;
    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("strict-dynamic");
    expect(scriptSrc).not.toContain("nonce-abc123");
  });

  it("embeds the per-request nonce in script-src when supplied", () => {
    delete process.env.R2_PUBLIC_URL;
    const value = buildContentSecurityPolicy(false, "abc123");
    const scriptSrc = value
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("script-src"))!;
    expect(scriptSrc).toContain("'nonce-abc123'");
    // strict-dynamic lets the nonce'd bootstrap pull the rest of the chunk graph.
    expect(scriptSrc).toContain("'strict-dynamic'");
    // The nonce must never leak into other fetch directives.
    const connectSrc = value
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("connect-src"))!;
    expect(connectSrc).not.toContain("nonce");
  });

  it("omits nonce/strict-dynamic from script-src when none is supplied", () => {
    delete process.env.R2_PUBLIC_URL;
    const value = buildContentSecurityPolicy(false);
    const scriptSrc = value
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("script-src"))!;
    expect(scriptSrc).not.toContain("nonce");
    expect(scriptSrc).not.toContain("strict-dynamic");
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

  it("allows same-origin camera but no other powerful features", () => {
    const keyed = Object.fromEntries(
      securityHeaders(false).map((h) => [h.key, h.value]),
    );
    const perms = keyed["Permissions-Policy"];
    // Same-origin getUserMedia for the admin image-capture flow.
    expect(perms).toContain("camera=(self)");
    // Everything else stays fully disabled.
    expect(perms).toContain("microphone=()");
    expect(perms).toContain("geolocation=()");
    expect(perms).toContain("browsing-topics=()");
  });

  it("threads a nonce into the CSP header when supplied", () => {
    const value = csp(securityHeaders(false, "nonceXYZ"));
    expect(value).toContain("'nonce-nonceXYZ'");
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
