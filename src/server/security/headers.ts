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
 */
export function buildContentSecurityPolicy(isDev: boolean): string {
  const imgOrigin = r2ImageOrigin();

  const imgSrc = ["'self'", "data:", "blob:"];
  if (imgOrigin) imgSrc.push(imgOrigin);

  const scriptSrc = ["'self'", TURNSTILE_ORIGIN];
  const connectSrc = ["'self'", TURNSTILE_ORIGIN];
  if (imgOrigin) connectSrc.push(imgOrigin);

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
 *
 * Usage in `next.config.ts`:
 * ```ts
 * async headers() {
 *   return [{ source: "/:path*", headers: securityHeaders() }];
 * }
 * ```
 */
export function securityHeaders(
  isDev: boolean = process.env.NODE_ENV !== "production",
): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    {
      key: "Content-Security-Policy",
      value: buildContentSecurityPolicy(isDev),
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
    // Drop powerful features we never use.
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
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
