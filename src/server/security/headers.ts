/**
 * Security response headers for MemoryDeals.
 *
 * Applied to every response (wire this into `next.config.ts` `headers()` or,
 * for per-request nonces, into middleware). The Content-Security-Policy is the
 * important one: it locks the app down to first-party resources plus the two
 * third-party origins we actually use — Cloudflare R2 (public product images)
 * and Cloudflare Turnstile (bot-protection widget on the auth/request flows).
 *
 * Nothing here weakens the price gate; it's defence-in-depth against XSS,
 * clickjacking, MIME sniffing and referrer leakage.
 */

/** Cloudflare Turnstile widget + its siteverify challenge origin. */
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/**
 * Public base URL for R2-served product images (e.g.
 * "https://images.memorydeals.com" or the r2.dev bucket URL). Read from
 * R2_PUBLIC_URL so a bucket move doesn't require a code change. Only the
 * origin is used in the CSP; any path component is stripped.
 */
function r2ImageOrigin(): string | null {
  const raw = process.env.R2_PUBLIC_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    // Misconfigured env — fail closed (no extra origin) rather than emit
    // a malformed CSP directive that browsers would reject wholesale.
    return null;
  }
}

/**
 * Build the Content-Security-Policy value.
 *
 * `isDev` relaxes two things Next.js needs in development: `'unsafe-eval'`
 * (React Fast Refresh / HMR) and websocket connections to the dev server.
 * Production stays strict. We intentionally allow `'unsafe-inline'` for
 * styles only (Tailwind/Next inject inline style tags); scripts do NOT get
 * `'unsafe-inline'` in production.
 *
 * `nonce` — the App Router injects inline bootstrap scripts on every document
 * (the `self.__next_r` request-id shim and the RSC flight payload). Under a
 * strict `script-src` those inline scripts are blocked, hydration never runs,
 * and every client component (including the login form) silently dies. The
 * correct fix is a per-request nonce: middleware mints one, threads it through
 * here, and Next stamps the same nonce onto its inline scripts (it reads it
 * back off the CSP request header). Callers that emit a static CSP (e.g. a
 * `next.config` `headers()` block) pass no nonce and get the nonce-free policy.
 */
export function buildContentSecurityPolicy(
  isDev: boolean,
  nonce?: string,
): string {
  const imgOrigin = r2ImageOrigin();

  const imgSrc = ["'self'", "data:", "blob:"];
  if (imgOrigin) imgSrc.push(imgOrigin);

  const scriptSrc = ["'self'", TURNSTILE_ORIGIN];
  const connectSrc = ["'self'", TURNSTILE_ORIGIN];
  if (imgOrigin) connectSrc.push(imgOrigin);

  if (nonce) {
    // Allow Next's inline bootstrap scripts, which carry this exact nonce.
    // `'strict-dynamic'` lets those trusted scripts load the rest of the
    // chunk graph without having to enumerate every hashed filename, while
    // still ignoring the host-based allowlist for scripts in modern browsers.
    scriptSrc.push(`'nonce-${nonce}'`, "'strict-dynamic'");
  }

  if (isDev) {
    // HMR + React Refresh need eval and a live websocket back to the dev server.
    scriptSrc.push("'unsafe-eval'");
    connectSrc.push("ws:", "wss:");
  }

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": scriptSrc,
    // Tailwind / Next emit inline <style>; scripts stay locked down.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": imgSrc,
    "font-src": ["'self'", "data:"],
    "connect-src": connectSrc,
    // Turnstile renders inside an iframe from its own origin.
    "frame-src": [TURNSTILE_ORIGIN],
    // We never embed anyone else's frames into ours beyond Turnstile above,
    // and nobody may frame us (clickjacking).
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
  };

  // `upgrade-insecure-requests` is valueless and only meaningful over HTTPS.
  const parts = Object.entries(directives).map(
    ([key, values]) => `${key} ${values.join(" ")}`,
  );
  if (!isDev) parts.push("upgrade-insecure-requests");

  return parts.join("; ");
}

export interface SecurityHeader {
  key: string;
  value: string;
}

/**
 * The full set of security headers.
 *
 * @param isDev  When true, relaxes CSP for the Next dev server and omits HSTS
 *               (HSTS on localhost would poison the browser for other local
 *               apps). Defaults to `NODE_ENV !== "production"`.
 * @param nonce  Per-request nonce to embed in `script-src` so the App Router's
 *               inline bootstrap scripts execute and the app can hydrate.
 *               Supplied by the middleware; omit for a static CSP.
 *
 * Usage in middleware (per-request nonce):
 * ```ts
 * const nonce = crypto.randomUUID();
 * for (const { key, value } of securityHeaders(isDev, nonce)) {
 *   response.headers.set(key, value);
 * }
 * ```
 */
export function securityHeaders(
  isDev: boolean = process.env.NODE_ENV !== "production",
  nonce?: string,
): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    {
      key: "Content-Security-Policy",
      value: buildContentSecurityPolicy(isDev, nonce),
    },
    // Block MIME-type sniffing.
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Legacy clickjacking guard (CSP frame-ancestors is the modern one).
    { key: "X-Frame-Options", value: "DENY" },
    // Send only the origin on cross-origin navigations; nothing on downgrade.
    {
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin",
    },
    // Drop powerful features we never use. `camera=(self)` keeps same-origin
    // getUserMedia available for the admin image-capture flow while still
    // denying every cross-origin frame; the rest stay fully disabled.
    {
      key: "Permissions-Policy",
      value: "camera=(self), microphone=(), geolocation=(), browsing-topics=()",
    },
    // Isolate our browsing context group.
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];

  if (!isDev) {
    // 2 years, include subdomains, eligible for the preload list.
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }

  return headers;
}
