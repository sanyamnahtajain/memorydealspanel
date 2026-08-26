import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { prisma } from "@/server/db";
import {
  ENTRY_GATE_OFF,
  entryCodeMatches,
  normalizeEntryCode,
  parseEntryGate,
  type EntryGate,
} from "@/lib/entry-gate";

/**
 * Server side of the entry gate (see src/lib/entry-gate.ts for what it is and
 * is not). This module owns:
 *
 *  - reading/writing the gate config on the StoreSettings singleton;
 *  - the device cookie a visitor earns by entering the code once, so they are
 *    not re-asked on every visit;
 *  - verifying that cookie inside the request/sign-up actions — the SERVER
 *    enforces the gate; the UI screen is only the front door.
 *
 * THE COOKIE IS BOUND TO THE CODE. Its value is HMAC(secret, current code),
 * so the moment the owner changes the code every previously issued cookie
 * stops verifying — "change the password" and "kick out everyone who had the
 * old one" are the same single action, which is the whole point of rotation
 * after a leak. No per-device revocation list needed.
 */

const SETTINGS_KEY = "default";
export const ENTRY_GATE_COOKIE = "md_gate";
/** How long a device that entered the code stays trusted. */
const GATE_COOKIE_MAX_AGE_S = 90 * 24 * 60 * 60;

function gateSecret(): string {
  // AUTH_SECRET is already required in production for sessions; reusing it
  // adds no new deployment step. The derivation prefix keeps this HMAC's
  // domain separate from anything else the secret signs.
  return process.env.AUTH_SECRET ?? "dev-only-entry-gate";
}

function gateToken(code: string): string {
  return createHmac("sha256", gateSecret())
    .update(`entry-gate:${normalizeEntryCode(code)}`)
    .digest("hex");
}

export async function getEntryGate(): Promise<EntryGate> {
  try {
    const row = await prisma.storeSettings.findUnique({
      where: { key: SETTINGS_KEY },
      select: { entryGate: true },
    });
    return parseEntryGate(row?.entryGate);
  } catch (error) {
    // Fail OPEN: this gate only reduces queue noise; a DB hiccup must not
    // stop every new customer from requesting access.
    console.error("[entry-gate] read failed:", error);
    return ENTRY_GATE_OFF;
  }
}

export async function updateEntryGate(gate: EntryGate): Promise<void> {
  await prisma.storeSettings.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, entryGate: gate },
    update: { entryGate: gate },
  });
  // The middleware caches this config (see getEntryGateCached); drop the
  // cache so the instance that took the save applies it immediately. Other
  // instances catch up within the TTL.
  (globalThis as { __mdGateCache?: unknown }).__mdGateCache = undefined;
}

/** Has THIS device already entered the current code? */
export async function hasPassedEntryGate(gate?: EntryGate): Promise<boolean> {
  const resolved = gate ?? (await getEntryGate());
  if (!resolved.enabled) return true;

  const cookieStore = await cookies();
  const presented = cookieStore.get(ENTRY_GATE_COOKIE)?.value;
  if (!presented) return false;

  const expected = gateToken(resolved.code);
  // Length check first: timingSafeEqual throws on unequal lengths.
  if (presented.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Verify an attempt and, on success, remember this device. Callers rate-limit
 * BEFORE calling this — the comparison itself is cheap and constant-time, but
 * unlimited guesses would still walk a short code.
 */
export async function passEntryGate(attempt: string): Promise<boolean> {
  const gate = await getEntryGate();
  if (!gate.enabled) return true;
  if (!entryCodeMatches(gate, attempt)) return false;

  const cookieStore = await cookies();
  cookieStore.set(ENTRY_GATE_COOKIE, gateToken(gate.code), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: GATE_COOKIE_MAX_AGE_S,
  });
  return true;
}

/* ------------------------------------------------------------------ */
/* middleware-facing (site-wide wall)                                  */
/* ------------------------------------------------------------------ */

/**
 * Cached read for the MIDDLEWARE, which runs on every request. A per-request
 * DB read there would put the settings row on the hot path of every page
 * view; a short TTL keeps it to one read per instance per interval instead.
 *
 * The trade-off is honest and small: flipping the toggle in admin settings
 * takes up to TTL to reach every running instance. The admin UI says so.
 *
 * Fail OPEN, always: if the read throws, the site behaves as if the gate is
 * off. This feature only filters noise — a database hiccup must never lock
 * every visitor out of the shop (the owner's explicit kill-switch demand).
 */
const GATE_CACHE_TTL_MS = 30_000;

const globalForGate = globalThis as unknown as {
  __mdGateCache: { at: number; gate: EntryGate; token: string } | undefined;
};

export async function getEntryGateCached(): Promise<{
  gate: EntryGate;
  /** The exact cookie value a passed device carries (empty when off). */
  token: string;
}> {
  const cached = globalForGate.__mdGateCache;
  if (cached && Date.now() - cached.at < GATE_CACHE_TTL_MS) {
    return { gate: cached.gate, token: cached.token };
  }
  const gate = await getEntryGate(); // already fails open internally
  const token = gate.enabled ? gateToken(gate.code) : "";
  globalForGate.__mdGateCache = { at: Date.now(), gate, token };
  return { gate, token };
}
