import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { siteBaseUrl } from "@/app/seo-site-url";

/**
 * Google sign-in for the STOREFRONT (customers). Env-gated: when
 * GOOGLE_CLIENT_ID/SECRET are absent the feature simply doesn't exist and
 * password auth carries on unchanged.
 *
 * Security invariants (mirrors the tradeOS implementation, single-host):
 *  - Server-side single-use flow rows (PKCE S256 verifier + nonce), never
 *    cookies; atomic claim on use; TTL enforced at read.
 *  - id_token verified against Google's JWKS (issuer, audience, signature,
 *    expiry) AND our nonce — no "trust the redirect" shortcuts.
 *  - Linking rule: by Google `sub` first; else by VERIFIED email only; else
 *    the visitor is NEW and must complete the request-access form (business
 *    name, phone, GST, city — exactly the same details as password signup).
 *  - BLOCKED customers are refused exactly like password login.
 *  - Google-created customers get an unusable random password hash; Google
 *    is their login. Password users who link keep their password too.
 */

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

const STATE_TTL_MS = 10 * 60 * 1000;
/**
 * The signup handoff rides the request-access form while it's filled in, so
 * its clock starts BEFORE the visitor has typed anything.
 *
 * Fifteen minutes was too short and produced the worst possible failure: a
 * shopkeeper filling five fields on a phone — often stopping to look up their
 * GSTIN — came back to "your Google sign-in expired", having lost the form.
 * They read that as the site asking them to sign in again for no reason.
 *
 * An hour is safe. The token is server-side, single-use, and already bound to
 * a Google-verified identity; the only thing the window bounds is how long an
 * unfinished signup form stays fillable.
 */
const SIGNUP_TTL_MS = 60 * 60 * 1000;

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function googleJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks) jwks = createRemoteJWKSet(new URL(JWKS_URL));
  return jwks;
}

export function googleOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function googleRedirectUri(): string {
  return `${siteBaseUrl().replace(/\/+$/, "")}/auth/google/callback`;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** Only ever bounce back to a same-host relative path. */
export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw) return "/";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

/** Begin the flow: persist the single-use state row, build the Google URL. */
export async function beginGoogleFlow(returnTo?: string | null): Promise<{ authorizeUrl: string }> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_NOT_CONFIGURED");

  const state = b64url(randomBytes(32));
  const nonce = b64url(randomBytes(16));
  const pkceVerifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(pkceVerifier).digest());

  await prisma.oAuthFlowState.create({
    data: {
      token: state,
      kind: "state",
      pkceVerifier,
      nonce,
      returnTo: safeReturnTo(returnTo),
      usedAt: null,
    },
  });

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", googleRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return { authorizeUrl: url.toString() };
}

interface FlowRow {
  id: string;
  pkceVerifier: string | null;
  nonce: string | null;
  email: string | null;
  name: string | null;
  sub: string | null;
  returnTo: string | null;
}

/** Consume a single-use flow row: unused + fresh, atomically marked used. */
async function consumeFlowRow(
  token: string,
  kind: "state" | "signup",
  ttlMs: number,
): Promise<FlowRow | null> {
  const row = await prisma.oAuthFlowState.findFirst({
    where: { token, kind, usedAt: null, createdAt: { gt: new Date(Date.now() - ttlMs) } },
    select: { id: true, pkceVerifier: true, nonce: true, email: true, name: true, sub: true, returnTo: true },
  });
  if (!row) return null;
  // updateMany with the usedAt:null predicate = atomic claim under a race.
  const claimed = await prisma.oAuthFlowState.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  return claimed.count === 1 ? row : null;
}

export interface GoogleIdentity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

/** Exchange + verify. Returns the verified identity or a typed failure. */
export async function completeGoogleCallback(input: {
  code: string;
  state: string;
}): Promise<
  | { ok: true; identity: GoogleIdentity; returnTo: string }
  | { ok: false; error: "bad_state" | "exchange_failed" | "bad_token" }
> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { ok: false, error: "exchange_failed" };

  const state = await consumeFlowRow(input.state, "state", STATE_TTL_MS);
  if (!state || !state.pkceVerifier || !state.nonce) return { ok: false, error: "bad_state" };

  let idToken: string;
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: input.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: googleRedirectUri(),
        grant_type: "authorization_code",
        code_verifier: state.pkceVerifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: "exchange_failed" };
    const data = (await res.json()) as { id_token?: string };
    if (!data.id_token) return { ok: false, error: "exchange_failed" };
    idToken = data.id_token;
  } catch {
    return { ok: false, error: "exchange_failed" };
  }

  try {
    const { payload } = await jwtVerify(idToken, googleJwks(), {
      issuer: ISSUERS,
      audience: clientId,
    });
    if (payload.nonce !== state.nonce || typeof payload.sub !== "string") {
      return { ok: false, error: "bad_token" };
    }
    return {
      ok: true,
      identity: {
        sub: payload.sub,
        email: typeof payload.email === "string" ? payload.email.toLowerCase() : null,
        emailVerified: payload.email_verified === true,
        name: typeof payload.name === "string" ? payload.name : null,
      },
      returnTo: safeReturnTo(state.returnTo),
    };
  } catch {
    return { ok: false, error: "bad_token" };
  }
}

export type GoogleResolution =
  | { kind: "customer"; customerId: string; blocked: boolean }
  | { kind: "new" };

/**
 * Resolve a VERIFIED Google identity to an existing customer, or "new".
 * Linking is by `sub` first, then by verified-email match (which also writes
 * the sub link so the next login is direct). Never creates a customer — the
 * request-access flow owns creation, so GST/phone/address are always captured.
 */
export async function resolveGoogleCustomer(identity: GoogleIdentity): Promise<GoogleResolution> {
  const bySub = await prisma.googleAccount.findUnique({
    where: { sub: identity.sub },
    select: { customerId: true },
  });
  if (bySub) {
    const c = await prisma.customer.findUnique({
      where: { id: bySub.customerId },
      select: { id: true, status: true },
    });
    if (c) return { kind: "customer", customerId: c.id, blocked: c.status === "BLOCKED" };
    // Link points at a deleted customer — clean it and treat as new.
    await prisma.googleAccount.deleteMany({ where: { sub: identity.sub } });
    return { kind: "new" };
  }

  if (identity.email && identity.emailVerified) {
    const byEmail = await prisma.customer.findFirst({
      where: { email: identity.email },
      select: { id: true, status: true },
    });
    if (byEmail) {
      await prisma.googleAccount.create({
        data: { sub: identity.sub, customerId: byEmail.id, email: identity.email },
      });
      return { kind: "customer", customerId: byEmail.id, blocked: byEmail.status === "BLOCKED" };
    }
  }
  return { kind: "new" };
}

/** Mint the single-use signup handoff for a NEW Google visitor. */
export async function createSignupHandoff(identity: GoogleIdentity): Promise<string> {
  const token = b64url(randomBytes(32));
  await prisma.oAuthFlowState.create({
    data: {
      token,
      kind: "signup",
      email: identity.email,
      name: identity.name,
      sub: identity.sub,
      usedAt: null,
    },
  });
  return token;
}

export interface SignupHandoff {
  email: string;
  name: string | null;
  sub: string;
}

/** READ-ONLY peek (form prefill) — does NOT consume. */
export async function peekSignupHandoff(token: string): Promise<SignupHandoff | null> {
  const row = await prisma.oAuthFlowState.findFirst({
    where: {
      token,
      kind: "signup",
      usedAt: null,
      createdAt: { gt: new Date(Date.now() - SIGNUP_TTL_MS) },
    },
    select: { email: true, name: true, sub: true },
  });
  if (!row || !row.email || !row.sub) return null;
  return { email: row.email, name: row.name, sub: row.sub };
}

/** Atomically consume the signup handoff at form submission (single-use). */
export async function consumeSignupHandoff(token: string): Promise<SignupHandoff | null> {
  const row = await consumeFlowRow(token, "signup", SIGNUP_TTL_MS);
  if (!row || !row.email || !row.sub) return null;
  return { email: row.email, name: row.name, sub: row.sub };
}

/**
 * REFUND a consumed signup handoff when request-access FAILED after the
 * consume (duplicate phone, rate-limit): nothing was created, so restoring
 * single-use lets the visitor fix the form without re-authing at Google.
 */
export async function refundSignupHandoff(token: string): Promise<void> {
  await prisma.oAuthFlowState.updateMany({
    where: { token, kind: "signup" },
    data: { usedAt: null },
  });
}

/** Link a Google identity to a JUST-CREATED customer (post request-access). */
export async function linkGoogleAccount(sub: string, customerId: string, email: string): Promise<void> {
  await prisma.googleAccount.upsert({
    where: { sub },
    create: { sub, customerId, email },
    update: { customerId, email },
  });
}

/** An unusable password hash for Google-created customers. */
export function randomPasswordHash(): Promise<string> {
  return hashPassword(randomBytes(24).toString("base64url"));
}
