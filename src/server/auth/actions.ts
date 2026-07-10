"use server";

import { headers } from "next/headers";
import { prisma } from "@/server/db";
import { loginLimiter } from "@/server/security/ratelimit";
import { writeAudit } from "@/server/security/audit";
import { indianPhoneSchema } from "@/lib/schemas/customer";
import { verifyPassword } from "./password";
import { verifyTotp } from "./totp";
import {
  createSession,
  destroyCookie,
  getSession,
  revokeSession,
  SESSION_COOKIE,
} from "./session";

/**
 * Authentication Server Actions.
 *
 * Every action returns a typed discriminated result and NEVER throws for
 * expected failures (bad credentials, rate limits, 2FA prompts). Callers
 * switch on `.status`. Login failures are intentionally generic
 * ("invalid_credentials") to avoid user enumeration.
 */

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type AdminLoginResult =
  | { status: "ok" }
  | { status: "totp_required" }
  | { status: "invalid_credentials" }
  | { status: "invalid_totp" }
  | { status: "rate_limited" };

export type CustomerLoginResult =
  | { status: "ok"; priceGated: boolean }
  | { status: "invalid_credentials" }
  | { status: "blocked" }
  | { status: "rate_limited" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Best-effort client IP for rate-limit keying; falls back to a constant. */
async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]!.trim();
  }
  return h.get("x-real-ip") ?? "unknown";
}

// ---------------------------------------------------------------------------
// Admin login
// ---------------------------------------------------------------------------

/**
 * Admin login with optional TOTP. When the admin has a totpSecret and no
 * (or an invalid) token was supplied, we return `totp_required` on the first
 * pass — but ONLY after the password checks out, so the 2FA prompt can never
 * be used to probe which emails exist.
 */
export async function adminLogin(
  email: string,
  password: string,
  totp?: string,
): Promise<AdminLoginResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const ip = await clientIp();

  const rl = await loginLimiter.limit(`admin:${normalizedEmail}:${ip}`);
  if (!rl.ok) {
    return { status: "rate_limited" };
  }

  const admin = await prisma.admin.findUnique({
    where: { email: normalizedEmail },
  });

  // Uniform work + generic error to avoid leaking whether the email exists.
  const passwordOk = admin
    ? await verifyPassword(password, admin.passwordHash)
    : await verifyPassword(password, "");
  if (!admin || !passwordOk) {
    return { status: "invalid_credentials" };
  }

  if (admin.totpSecret) {
    if (!totp) {
      return { status: "totp_required" };
    }
    const totpOk = await verifyTotp(admin.totpSecret, totp);
    if (!totpOk) {
      return { status: "invalid_totp" };
    }
  }

  await createSession({ kind: "admin", adminId: admin.id });
  await writeAudit({
    actorType: "admin",
    actorId: admin.id,
    action: "admin.login",
    entity: "Admin",
    entityId: admin.id,
  });

  return { status: "ok" };
}

// ---------------------------------------------------------------------------
// Customer login
// ---------------------------------------------------------------------------

/**
 * Customer login by phone + password. Phone is normalized to canonical
 * "+91..." form before lookup. BLOCKED customers are refused even with valid
 * credentials. A successful login always creates a session; whether prices
 * are visible is a separate concern surfaced via `priceGated`.
 */
export async function customerLogin(
  phone: string,
  password: string,
): Promise<CustomerLoginResult> {
  const ip = await clientIp();

  const parsed = indianPhoneSchema.safeParse(phone);
  if (!parsed.success) {
    // Still consume a rate-limit point keyed on IP to slow enumeration.
    await loginLimiter.limit(`customer:${ip}`);
    return { status: "invalid_credentials" };
  }
  const normalizedPhone = parsed.data;

  const rl = await loginLimiter.limit(`customer:${normalizedPhone}:${ip}`);
  if (!rl.ok) {
    return { status: "rate_limited" };
  }

  const customer = await prisma.customer.findUnique({
    where: { phone: normalizedPhone },
  });

  const passwordOk = customer
    ? await verifyPassword(password, customer.passwordHash)
    : await verifyPassword(password, "");
  if (!customer || !passwordOk) {
    return { status: "invalid_credentials" };
  }

  if (customer.status === "BLOCKED") {
    await writeAudit({
      actorType: "customer",
      actorId: customer.id,
      action: "customer.login.blocked",
      entity: "Customer",
      entityId: customer.id,
    });
    return { status: "blocked" };
  }

  await createSession({ kind: "customer", customerId: customer.id });
  await prisma.customer.update({
    where: { id: customer.id },
    data: { lastLoginAt: new Date() },
  });
  await writeAudit({
    actorType: "customer",
    actorId: customer.id,
    action: "customer.login",
    entity: "Customer",
    entityId: customer.id,
  });

  // priceGated => prices are hidden (status not APPROVED). The DAL recomputes
  // the authoritative grant check via resolveViewer; this is a UI hint only.
  return { status: "ok", priceGated: customer.status !== "APPROVED" };
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

/** Revoke the current session (if any) and clear the cookie. Idempotent. */
export async function logout(): Promise<void> {
  const session = await getSession();
  const cookieHeader = (await headers()).get("cookie");
  // Prefer revoking by the exact token from the cookie so we soft-delete the
  // right row; fall back to no-op if the cookie is gone.
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (token) {
    await revokeSession(token);
  }
  if (session) {
    await writeAudit({
      actorType: session.adminId ? "admin" : "customer",
      actorId: session.adminId ?? session.customerId ?? "unknown",
      action: "auth.logout",
      entity: session.adminId ? "Admin" : "Customer",
      entityId: session.adminId ?? session.customerId ?? "unknown",
    });
  }
  await destroyCookie();
}

/** Minimal cookie-header parser (avoids re-reading the async cookie store). */
function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}
