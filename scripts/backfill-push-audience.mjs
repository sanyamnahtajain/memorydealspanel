/**
 * One-time backfill: stamp `audience: "admin"` onto PushSubscription rows
 * written before the field existed.
 *
 * WHY THIS IS NEEDED. Until push was opened to customers, every subscription
 * belonged to a staff device, and the column did not exist. MongoDB stores
 * nothing for an absent field, and a Prisma default is applied on WRITE only —
 * it does not reach back and fill old documents. So those rows have no
 * `audience` at all.
 *
 * That matters because the sender selects staff devices with an exact match on
 * `audience: "admin"`. A document with the field ABSENT does not match that —
 * and, as it turns out, does not match `{ audience: null }` or
 * `{ audience: { not: "customer" } }` either. Without this backfill the shop's
 * existing staff phones would quietly stop receiving order alerts: no error,
 * no failure, just silence. That is the worst possible failure mode for the
 * one notification the owner cannot afford to miss.
 *
 * Safe to run more than once: it only touches documents where the field is
 * missing, so a second run reports 0 and changes nothing. It never deletes or
 * overwrites an existing value.
 *
 * Run against production ONCE, after deploying:
 *   node scripts/backfill-push-audience.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const target = process.env.DATABASE_URL ?? "(no DATABASE_URL set)";
  // Print only the host, never the credentials in the connection string.
  const host = target.replace(/^mongodb(\+srv)?:\/\/[^@]*@/, "mongodb://***@");
  console.log(`[backfill] database: ${host}`);

  const before = await prisma.$runCommandRaw({
    count: "PushSubscription",
    query: { audience: { $exists: false } },
  });
  const pending = Number(before.n ?? 0);
  console.log(`[backfill] subscriptions with no audience: ${pending}`);

  if (pending === 0) {
    console.log("[backfill] nothing to do.");
    return;
  }

  const result = await prisma.$runCommandRaw({
    update: "PushSubscription",
    updates: [
      {
        q: { audience: { $exists: false } },
        u: { $set: { audience: "admin" } },
        multi: true,
      },
    ],
  });
  console.log(`[backfill] updated: ${Number(result.nModified ?? 0)}`);

  const after = await prisma.$runCommandRaw({
    count: "PushSubscription",
    query: { audience: { $exists: false } },
  });
  const remaining = Number(after.n ?? 0);
  console.log(
    remaining === 0
      ? "[backfill] done — every staff device can be reached again."
      : `[backfill] WARNING: ${remaining} still missing an audience.`,
  );
}

main()
  .catch((error) => {
    console.error("[backfill] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
