import { beginGoogleFlow, googleOAuthConfigured, safeReturnTo } from "@/server/services/google-auth";

/**
 * Google sign-in entry (storefront). Env-gated — 404s outright when the
 * GOOGLE_* env is absent, so the feature simply doesn't exist unless
 * configured. Creates the single-use server-side flow state (PKCE + nonce)
 * and bounces to Google; the callback lands on /auth/google/callback.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!googleOAuthConfigured()) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
  const { authorizeUrl } = await beginGoogleFlow(returnTo);
  return Response.redirect(authorizeUrl, 302);
}
