import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { prismaPushStore } from "./push";

/**
 * Audience routing against the REAL Mongo store.
 *
 * These tests exist because of a bug that unit tests with the in-memory store
 * could never have caught: subscriptions written before the `audience` column
 * existed have the field ABSENT, and in MongoDB an absent field matches
 * neither `{ audience: null }` (Prisma rejects it outright on a required
 * field) nor `{ audience: { not: "customer" } }`. The first version of the
 * sender used exactly those filters, so every pre-existing staff phone would
 * have stopped receiving order alerts — silently, because the store swallows
 * query errors and returns an empty list.
 *
 * The fix is the backfill in scripts/backfill-push-audience.mjs. What is
 * pinned here is the contract that makes the backfill necessary AND correct:
 * an exact audience match, and no leakage between the two audiences.
 */

const LEGACY = "https://push.test/legacy-absent-audience";
const ADMIN = "https://push.test/admin-device";
const CUSTOMER = "https://push.test/customer-device";
const ALL = [LEGACY, ADMIN, CUSTOMER];

async function removeFixtures(): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: ALL } } });
}

/** Insert a row shaped exactly like one written before the column existed. */
async function insertLegacyRow(): Promise<void> {
  // Raw insert: going through Prisma would apply the default and hide the
  // very condition under test.
  await prisma.$runCommandRaw({
    insert: "PushSubscription",
    documents: [
      {
        endpoint: LEGACY,
        p256dh: "key",
        auth: "auth",
        createdAt: { $date: new Date().toISOString() },
      },
    ],
  });
}

/** The one statement scripts/backfill-push-audience.mjs runs. */
async function runBackfill(): Promise<void> {
  await prisma.$runCommandRaw({
    update: "PushSubscription",
    updates: [
      {
        q: { audience: { $exists: false } },
        u: { $set: { audience: "admin" } },
        multi: true,
      },
    ],
  });
}

beforeEach(removeFixtures);
afterEach(removeFixtures);

describe("push store — audience routing", () => {
  it("keeps a customer device out of the staff audience", async () => {
    // The important direction: a buyer's phone must never be handed a staff
    // alert, which would leak other customers' orders.
    await prismaPushStore.save({
      endpoint: CUSTOMER,
      keys: { p256dh: "key", auth: "auth" },
      audience: "customer",
      customerId: "507f1f77bcf86cd799439011",
    });

    const admins = await prismaPushStore.list({ audience: "admin" });
    expect(admins.map((s) => s.endpoint)).not.toContain(CUSTOMER);

    const customers = await prismaPushStore.list({ audience: "customer" });
    expect(customers.map((s) => s.endpoint)).toContain(CUSTOMER);
  });

  it("keeps a staff device out of the customer audience", async () => {
    await prismaPushStore.save({
      endpoint: ADMIN,
      keys: { p256dh: "key", auth: "auth" },
      audience: "admin",
      adminId: "507f1f77bcf86cd799439012",
    });

    const customers = await prismaPushStore.list({ audience: "customer" });
    expect(customers.map((s) => s.endpoint)).not.toContain(ADMIN);

    const admins = await prismaPushStore.list({ audience: "admin" });
    expect(admins.map((s) => s.endpoint)).toContain(ADMIN);
  });

  it("narrows to one buyer's own devices", async () => {
    await prismaPushStore.save({
      endpoint: CUSTOMER,
      keys: { p256dh: "key", auth: "auth" },
      audience: "customer",
      customerId: "507f1f77bcf86cd799439011",
    });

    const mine = await prismaPushStore.list({
      audience: "customer",
      customerId: "507f1f77bcf86cd799439011",
    });
    expect(mine.map((s) => s.endpoint)).toContain(CUSTOMER);

    const someoneElse = await prismaPushStore.list({
      audience: "customer",
      customerId: "507f1f77bcf86cd799439099",
    });
    expect(someoneElse.map((s) => s.endpoint)).not.toContain(CUSTOMER);
  });
});

describe("push store — rows written before the audience column existed", () => {
  it("does NOT reach them without the backfill (why the script exists)", async () => {
    await insertLegacyRow();

    const admins = await prismaPushStore.list({ audience: "admin" });
    // Documents the trap: an absent field is not an empty one. If this ever
    // starts passing, the backfill has become optional — verify before
    // relaxing anything that depends on it.
    expect(admins.map((s) => s.endpoint)).not.toContain(LEGACY);
  });

  it("reaches them once the backfill has run", async () => {
    await insertLegacyRow();
    await runBackfill();

    const admins = await prismaPushStore.list({ audience: "admin" });
    expect(admins.map((s) => s.endpoint)).toContain(LEGACY);
  });

  it("backfills as an admin device, never a customer one", async () => {
    await insertLegacyRow();
    await runBackfill();

    const customers = await prismaPushStore.list({ audience: "customer" });
    expect(customers.map((s) => s.endpoint)).not.toContain(LEGACY);
  });

  it("is safe to run twice", async () => {
    await insertLegacyRow();
    await runBackfill();
    await runBackfill();

    const admins = await prismaPushStore.list({ audience: "admin" });
    expect(admins.filter((s) => s.endpoint === LEGACY)).toHaveLength(1);
  });

  it("does not overwrite an audience that is already set", async () => {
    await prismaPushStore.save({
      endpoint: CUSTOMER,
      keys: { p256dh: "key", auth: "auth" },
      audience: "customer",
      customerId: "507f1f77bcf86cd799439011",
    });
    await runBackfill();

    const customers = await prismaPushStore.list({ audience: "customer" });
    expect(customers.map((s) => s.endpoint)).toContain(CUSTOMER);
  });
});
