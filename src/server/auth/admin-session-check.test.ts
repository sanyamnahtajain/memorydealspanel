import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { resetSwrCache } from "@/server/cache/swr";
import { checkAdminSession } from "./admin-session-check";

/**
 * The proxy's fast "is this admin session alive?" check, against a real Mongo.
 *
 * WHY IT EXISTS: with only a cookie-presence check, an admin whose 24h session
 * had expired reached the page, which streamed its loading skeleton and sent
 * the login redirect inside the RSC payload — a redirect that needs client JS.
 * When hydration failed (a CSP-blocked chunk, at the time) the skeleton was a
 * dead end. A verdict of "dead" lets the proxy send a real 307 instead.
 */

const made: string[] = [];
afterEach(async () => {
  if (made.length) {
    await prisma.session.deleteMany({ where: { id: { in: made } } });
    made.length = 0;
  }
  resetSwrCache();
});

async function mint(opts: { admin: boolean; expiresInMs: number; revoked?: boolean }) {
  const admin = await prisma.admin.findFirst({ select: { id: true } });
  const customer = await prisma.customer.findFirst({ select: { id: true } });
  if (!admin || !customer) throw new Error("seed an admin and a customer first");
  const token = randomBytes(32).toString("hex");
  const row = await prisma.session.create({
    data: {
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + opts.expiresInMs),
      adminId: opts.admin ? admin.id : null,
      customerId: opts.admin ? null : customer.id,
      ipAddress: "127.0.0.1",
      userAgent: "qa",
      revokedAt: opts.revoked ? new Date() : null,
    },
    select: { id: true },
  });
  made.push(row.id);
  return token;
}

describe("checkAdminSession", () => {
  it("a live admin session is live", async () => {
    expect(await checkAdminSession(await mint({ admin: true, expiresInMs: 60_000 }))).toBe("live");
  });

  it("an EXPIRED admin session is dead — the every-morning case", async () => {
    expect(await checkAdminSession(await mint({ admin: true, expiresInMs: -1_000 }))).toBe("dead");
  });

  it("a revoked admin session is dead", async () => {
    expect(
      await checkAdminSession(await mint({ admin: true, expiresInMs: 60_000, revoked: true })),
    ).toBe("dead");
  });

  it("a token nobody issued is dead, and an empty one never reaches the database", async () => {
    expect(await checkAdminSession(randomBytes(32).toString("hex"))).toBe("dead");
    expect(await checkAdminSession("")).toBe("dead");
  });

  it("a CUSTOMER session on an admin URL is not its call — unknown, so the page decides", async () => {
    expect(await checkAdminSession(await mint({ admin: false, expiresInMs: 60_000 }))).toBe("unknown");
  });

  it("answers repeat checks from cache", async () => {
    const token = await mint({ admin: true, expiresInMs: 60_000 });
    await checkAdminSession(token);
    const started = Date.now();
    for (let i = 0; i < 20; i++) await checkAdminSession(token);
    expect(Date.now() - started).toBeLessThan(200);
  });
});
