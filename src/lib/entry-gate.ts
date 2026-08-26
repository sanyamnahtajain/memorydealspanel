import { z } from "zod";

/**
 * The entry gate — a shop code Raghav hands out, required BEFORE a new
 * visitor can ask for price access (owner request).
 *
 * THE THREAT THIS ANSWERS is volume, not determined attackers. Going viral on
 * Instagram means hundreds of casual visitors and single-piece buyers filing
 * requests into a queue meant for wholesale businesses, each one reviewed by
 * hand. A shared code distributed person-to-person (WhatsApp, in the shop)
 * filters exactly that crowd, and changing it instantly locks out every
 * second-hand copy — see the token binding below.
 *
 * WHAT THE GATE IS NOT: an authentication factor. It never identifies anyone
 * and grants nothing by itself — behind it sit the same request form and the
 * same manual approval as before. That is why a per-business, single-use
 * invite scheme (the "more secure" design) was deliberately not chosen: at
 * hundreds of requests a day it would turn distribution itself into admin
 * work, and the payoff is filtering people who were never going to be
 * approved anyway. If distribution ever needs to be traceable per business,
 * that is the upgrade path.
 *
 * WHO IS NEVER ASKED: existing customers. Sign-in (password, or an already
 * linked / email-matched Google account) bypasses the gate entirely — it
 * protects NEW INTAKE only. Gating sign-in would punish exactly the people
 * the shop wants back.
 *
 * The code is stored retrievably (not hashed) ON PURPOSE: the owner has to
 * read it back out of the settings screen to share it. It is a distribution
 * code, not a credential — nothing about an account depends on it.
 */

export const entryGateSchema = z.object({
  enabled: z.boolean(),
  /**
   * The shop code. Compared case-insensitively and whitespace-trimmed,
   * because it will be read aloud over the phone and typed on phone
   * keyboards that "helpfully" capitalise.
   */
  code: z.string().trim().min(4).max(32),
});

export type EntryGate = z.infer<typeof entryGateSchema>;

/** The gate before it has ever been configured: off, nothing required. */
export const ENTRY_GATE_OFF: EntryGate = { enabled: false, code: "" };

/**
 * Defensive read of the stored JSON. Absent or malformed => OFF — a broken
 * settings row must fail open here: this gate only reduces queue noise, and
 * failing closed would silently stop every new customer from requesting.
 */
export function parseEntryGate(value: unknown): EntryGate {
  if (value === null || value === undefined) return ENTRY_GATE_OFF;
  const parsed = entryGateSchema.safeParse(value);
  if (!parsed.success) return ENTRY_GATE_OFF;
  // Enabled with no usable code is a misconfiguration; treat as off rather
  // than locking the door with no key in existence.
  if (parsed.data.enabled && parsed.data.code.length < 4) return ENTRY_GATE_OFF;
  return parsed.data;
}

/** The comparison both sides use — trimmed, case-insensitive. */
export function normalizeEntryCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function entryCodeMatches(gate: EntryGate, attempt: string): boolean {
  if (!gate.enabled) return true;
  return (
    normalizeEntryCode(attempt) === normalizeEntryCode(gate.code) &&
    gate.code.length > 0
  );
}
