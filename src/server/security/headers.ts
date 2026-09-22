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
 * S3 API origin(s) the browser uploads product/brand images to via a presigned
 * PUT. This is a DIFFERENT host from the public read domain (`R2_PUBLIC_URL`):
 * the S3 endpoint is `https://<account>.r2.cloudflarestorage.com`, and the AWS
 * SDK emits **virtual-hosted-style** URLs by default
 * (`https://<bucket>.<account>.r2.cloudflarestorage.com`). Both must be in
 * `connect-src` or the upload is blocked by CSP before it ever leaves the page.
 * Derived from `R2_ACCOUNT_ID` (+ `R2_BUCKET`); empty when R2 isn't configured
 * (local-disk dev uploads are same-origin and need no extra source).
 */
function r2UploadOrigins(): string[] {
  const account = process.env.R2_ACCOUNT_ID?.trim();
  if (!account) return [];
  const origins = [`https://${account}.r2.cloudflarestorage.com`];
  const bucket = process.env.R2_BUCKET?.trim();
  if (bucket) {
    origins.push(`https://${bucket}.${account}.r2.cloudflarestorage.com`);
  }
  return origins;
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

  // Product demo videos stream from the SAME public bucket as the images.
  // Without an explicit `media-src`, <video> falls back to `default-src
  // 'self'` and every clip is blocked with no visible error — the player just
  // renders empty. `blob:` covers the local object URL used to preview a clip
  // in the admin before it has finished uploading.
  const mediaSrc = ["'self'", "blob:"];
  if (imgOrigin) mediaSrc.push(imgOrigin);

  const scriptSrc = ["'self'", TURNSTILE_ORIGIN];
  const connectSrc = ["'self'", TURNSTILE_ORIGIN];
  if (imgOrigin) connectSrc.push(imgOrigin);
  // Presigned direct-to-R2 image uploads (PUT) target the S3 API host, which
  // is not the public read domain above — allow it or uploads are CSP-blocked.
  for (const uploadOrigin of r2UploadOrigins()) connectSrc.push(uploadOrigin);

  if (isDev) {
    // DEV ONLY — relaxed script policy. Next's dev server (Turbopack) does NOT
    // reliably stamp the per-request nonce onto its inline bootstrap + chunk
    // `<script>` tags, and `'strict-dynamic'` disables the `'self'` host
    // allowlist, so a nonce'd policy blocks EVERY script and the app never
    // hydrates. In dev we therefore drop the nonce/`strict-dynamic` and allow
    // `'unsafe-inline'` + `'unsafe-eval'` (HMR/React-Refresh need eval; the
    // bootstrap scripts need inline). Production keeps the strict nonce policy
    // below. `connect-src` (incl. the R2 upload origins) stays strict in dev.
    scriptSrc.push("'unsafe-inline'", "'unsafe-eval'");
    connectSrc.push("ws:", "wss:");
  } else if (nonce) {
    // Production: inline scripts must carry this exact nonce; external chunks
    // are covered by the `'self'` host allowlist above.
    //
    // INCIDENT NOTE — this used to add `'strict-dynamic'` as well, and that
    // took the admin console down. `'strict-dynamic'` DISABLES the `'self'`
    // allowlist, so every chunk needed the nonce too. Next stamps it onto the
    // chunks it lists in the document head, but NOT onto the extra chunk
    // `<script>` elements it emits inside the RSC payload for client
    // components (the admin shell's shared icon chunk is one). Chrome blocked
    // that chunk on every admin page, React never hydrated, and the admin sat
    // on its loading skeleton forever: the charts never drew, the live-events
    // stream never opened, and an expired session's client-side redirect to
    // the login page never ran. The storefront happened not to have such a
    // chunk, which is the only reason it worked.
    //
    // What is given up: an attacker who can get a script file served from OUR
    // origin could run it. Uploads live on R2 (a different origin) and nothing
    // serves user content from this host, so that surface is empty here.
    // Inline injection — the realistic XSS vector — still needs the nonce.
    scriptSrc.push(`'nonce-${nonce}'`);
  }

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": scriptSrc,
    // Tailwind / Next emit inline <style>; scripts stay locked down.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": imgSrc,
    "media-src": mediaSrc,
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
