import { afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

import { prisma } from "@/server/db";
import {
  parseUserAgent,
  listSessions,
  listSessionsForSubject,
  countActiveSessionsForSubject,
  revokeSessionById,
  revokeAllForSubject,
} from "./sessions";

/**
 * Tests for the session directory service.
 *
 *  1. `parseUserAgent` — pure, hermetic string parsing (no DB).
 *  2. Revoke flows — integration against the SEEDED local MongoDB. Every test
 *     is self-cleaning: it creates throwaway Session rows attached to an
 *     existing admin and deletes them in `afterEach`, leaving the seed intact.
 */

/* --------------------------------------------------------------------- */
/* parseUserAgent (pure)                                                 */
/* --------------------------------------------------------------------- */

describe("parseUserAgent", () => {
  it("recognises Chrome on Windows", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
    const parsed = parseUserAgent(ua);
    expect(parsed.browser).toBe("Chrome");
    expect(parsed.os).toBe("Windows");
    expect(parsed.device).toBe("desktop");
    expect(parsed.label).toBe("Chrome on Windows");
  });

  it("recognises Safari on iOS as a mobile device", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
    const parsed = parseUserAgent(ua);
    expect(parsed.browser).toBe("Safari");
    expect(parsed.os).toBe("iOS");
    expect(parsed.device).toBe("mobile");
    expect(parsed.label).toBe("Safari on iOS");
  });

  it("distinguishes Edge from Chrome", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0";
    expect(parseUserAgent(ua).browser).toBe("Edge");
  });

  it("treats an iPad UA as a tablet", () => {
    const ua =
      "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/604.1";
    expect(parseUserAgent(ua).device).toBe("tablet");
  });

  it("flags bots / automated clients", () => {
    const parsed = parseUserAgent("curl/8.4.0");
    expect(parsed.device).toBe("bot");
    expect(parsed.label).toBe("Automated client");
  });

  it("degrades gracefully for empty / unknown agents", () => {
    expect(parseUserAgent("").label).toBe("Unknown device");
    expect(parseUserAgent(null).device).toBe("unknown");
    expect(parseUserAgent(undefined).browser).toBe("Unknown");
  });
});

/* --------------------------------------------------------------------- */
/* Revoke flows (DB-backed, self-cleaning)                               */
/* --------------------------------------------------------------------- */

const createdSessions: string[] = [];

afterEach(async () => {
  if (createdSessions.length > 0) {
    await prisma.session.deleteMany({ where: { id: { in: createdSessions } } });
    createdSessions.length = 0;
  }
});

/** Any existing admin to hang throwaway sessions off of. */
async function anAdminId(): Promise<string> {
  const admin = await prisma.admin.findFirst({ select: { id: true } });
  if (!admin) throw new Error("Seed is missing an admin to attach sessions to");
  return admin.id;
}

/** Creates a throwaway active admin session and tracks it for cleanup. */
async function makeSession(adminId: string, overrides?: { userAgent?: string }) {
  const session = await prisma.session.create({
    data: {
      tokenHash: randomBytes(32).toString("hex"),
      adminId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      userAgent:
        overrides?.userAgent ??
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
      ipAddress: "203.0.113.7",
    },
    select: { id: true },
  });
  createdSessions.push(session.id);
  return session.id;
}

describe("revokeSessionById", () => {
  it("soft-deletes a session and reports its subject", async () => {
    const adminId = await anAdminId();
    const id = await makeSession(adminId);

    const target = await revokeSessionById(id);
    expect(target).toEqual({ kind: "admin", subjectId: adminId });

    const row = await prisma.session.findUnique({
      where: { id },
      select: { revokedAt: true },
    });
    expect(row?.revokedAt).toBeInstanceOf(Date);
  });

  it("is idempotent and preserves the original revokedAt", async () => {
    const adminId = await anAdminId();
    const id = await makeSession(adminId);

    await revokeSessionById(id);
    const first = await prisma.session.findUnique({
      where: { id },
      select: { revokedAt: true },
    });

    const second = await revokeSessionById(id);
    expect(second).toEqual({ kind: "admin", subjectId: adminId });
    const after = await prisma.session.findUnique({
      where: { id },
      select: { revokedAt: true },
    });
    expect(after?.revokedAt?.getTime()).toBe(first?.revokedAt?.getTime());
  });

  it("returns null for an unknown id", async () => {
    const missing = randomBytes(12).toString("hex");
    expect(await revokeSessionById(missing)).toBeNull();
  });
});

describe("revokeAllForSubject + reads", () => {
  it("revokes every active session and drops the active count to zero", async () => {
    const adminId = await anAdminId();
    await makeSession(adminId);
    await makeSession(adminId);

    const before = await countActiveSessionsForSubject("admin", adminId);
    expect(before).toBeGreaterThanOrEqual(2);

    const revoked = await revokeAllForSubject("admin", adminId);
    expect(revoked).toBeGreaterThanOrEqual(2);

    expect(await countActiveSessionsForSubject("admin", adminId)).toBe(0);

    // The rows still exist (soft delete) and now read as revoked.
    const forSubject = await listSessionsForSubject("admin", adminId);
    expect(forSubject.every((s) => s.revoked)).toBe(true);
  });

  it("surfaces the parsed device in the listing", async () => {
    const adminId = await anAdminId();
    await makeSession(adminId, {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
    });

    const { sessions } = await listSessions({ kind: "admin", pageSize: 100 });
    const mine = sessions.filter((s) => createdSessions.includes(s.id));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine[0]!.device.browser).toBe("Chrome");
    expect(mine[0]!.kind).toBe("admin");
  });
});
