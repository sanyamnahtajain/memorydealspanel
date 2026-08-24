import { headers } from "next/headers";
import { prisma } from "@/server/db";
import { createSession } from "@/server/auth/session";
import { writeAudit } from "@/server/security/audit";
import { computeCustomerPriceAccess } from "@/server/services/access";
import {
  completeGoogleCallback,
  createSignupHandoff,
  googleOAuthConfigured,
  resolveGoogleCustomer,
} from "@/server/services/google-auth";

/**
 * Google callback (storefront). Verifies the flow (single-use state, PKCE
 * exchange, id_token via Google JWKS + nonce), then:
 *  - a linked / verified-email-matched customer signs in (BLOCKED refused,
 *    exactly like password login; PENDING logs in price-gated);
 *  - a NEW visitor gets a single-use signup handoff and completes the normal
 *    request-access form (business name, phone, GST, city) — Google replaces
 *    only the password+email, never the business details.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!googleOAuthConfigured()) return new Response("Not found", { status: 404 });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const to = (path: string) => Response.redirect(new URL(path, url.origin), 302);
  if (!code || !state) return to("/account/login?error=google_cancelled");

  const result = await completeGoogleCallback({ code, state });
  if (!result.ok) return to(`/account/login?error=google_${result.error}`);

  // A VERIFIED email is required — it is the only linking key we trust.
  if (!result.identity.email || !result.identity.emailVerified) {
    return to("/account/login?error=google_unverified_email");
  }

  const resolution = await resolveGoogleCustomer(result.identity);

  if (resolution.kind === "customer") {
    if (resolution.blocked) return to("/account/login?error=google_blocked");
    const h = await headers();
    await createSession(
      { kind: "customer", customerId: resolution.customerId },
      {
        ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"),
        userAgent: h.get("user-agent"),
      },
    );
    await prisma.customer.update({
      where: { id: resolution.customerId },
      data: { lastLoginAt: new Date() },
    });
    await writeAudit({
      actorType: "customer",
      actorId: resolution.customerId,
      action: "customer.login.google",
      entity: "Customer",
      entityId: resolution.customerId,
    });
    // STATUS-AWARE LANDING (owner request): a returning customer whose access
    // isn't live must never be dumped somewhere that looks like a failed
    // login. Live access → wherever they came from. Lapsed/expired/rejected →
    // the account page with the one-tap renewal dialog auto-open. Pending →
    // the account page's "under review" state.
    const row = await prisma.customer.findUnique({
      where: { id: resolution.customerId },
      select: { status: true },
    });
    const live =
      row?.status === "APPROVED" &&
      (await computeCustomerPriceAccess(resolution.customerId));
    if (live) return to(result.returnTo || "/account");
    if (row?.status === "PENDING") return to("/account");
    return to("/account?renew=1");
  }

  // New visitor → complete the request-access form with the verified email.
  const token = await createSignupHandoff(result.identity);
  return to(`/account/request-access?g=${encodeURIComponent(token)}`);
}
