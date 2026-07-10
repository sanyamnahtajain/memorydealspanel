/**
 * Cloudflare Turnstile server-side verification.
 *
 * When TURNSTILE_SECRET_KEY is unset (local dev, CI) verification is skipped
 * and every token is accepted, with a one-time warning so it's obvious the
 * check is disabled.
 */

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileResult {
  ok: boolean;
  /** Cloudflare error codes when verification fails (for logging only). */
  errorCodes?: string[];
}

const globalForTurnstile = globalThis as unknown as {
  __memorydealsTurnstileWarned: boolean | undefined;
};

interface SiteverifyResponse {
  success: boolean;
  "error-codes"?: string[];
}

/**
 * Verify a Turnstile token. `ip` is the client IP (pass the value from
 * x-forwarded-for / request context) and improves Cloudflare's scoring.
 */
export async function verifyTurnstile(
  token: string,
  ip?: string,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    if (!globalForTurnstile.__memorydealsTurnstileWarned) {
      globalForTurnstile.__memorydealsTurnstileWarned = true;
      console.warn(
        "[turnstile] TURNSTILE_SECRET_KEY is not set — CAPTCHA verification is DISABLED. All tokens are accepted. Do not run production like this.",
      );
    }
    return { ok: true };
  }

  if (!token) {
    return { ok: false, errorCodes: ["missing-input-response"] };
  }

  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      // Turnstile verification should never hang a login request.
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      console.error(
        `[turnstile] siteverify responded with HTTP ${res.status}`,
      );
      return { ok: false, errorCodes: [`http-${res.status}`] };
    }

    const data = (await res.json()) as SiteverifyResponse;
    if (data.success) {
      return { ok: true };
    }
    return { ok: false, errorCodes: data["error-codes"] ?? [] };
  } catch (error) {
    console.error("[turnstile] siteverify request failed:", error);
    return { ok: false, errorCodes: ["network-error"] };
  }
}
