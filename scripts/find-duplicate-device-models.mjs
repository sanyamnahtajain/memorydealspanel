/**
 * Report duplicate DeviceModel names (and slugs) that block the unique index.
 *
 * `prisma db push` builds `DeviceModel_name_key` as a UNIQUE index. If two
 * rows share a name, MongoDB refuses to build it and the WHOLE push aborts —
 * taking every other index with it. This script finds the offenders so they
 * can be merged by hand.
 *
 * STRICTLY READ-ONLY. It changes nothing. Deduplicating device models is not
 * safe to automate: order lines reference a model by id in their frozen
 * `breakdown` snapshots, so deleting the "wrong" duplicate would orphan
 * historical orders. This tells you which copy is actually in use so you can
 * keep that one.
 *
 * Run against production (never leave this URL in .env):
 *
 *   DATABASE_URL="mongodb+srv://..." node scripts/find-duplicate-device-models.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Group rows by a key, keeping only the groups with more than one member. */
function duplicatesBy(rows, pick) {
  const groups = new Map();
  for (const row of rows) {
    const key = pick(row);
    if (key === null || key === undefined || key === "") continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.entries()].filter(([, rows]) => rows.length > 1);
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  console.log(
    `[dupes] database host: ${url.replace(/^mongodb(\+srv)?:\/\/[^@]*@/, "mongodb://***@").split("/")[2] ?? "(unknown)"}\n`,
  );

  const models = await prisma.deviceModel.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      brandName: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  console.log(`[dupes] device models: ${models.length}`);

  const byName = duplicatesBy(models, (m) => m.name?.trim().toLowerCase());
  const bySlug = duplicatesBy(models, (m) => m.slug?.trim().toLowerCase());

  if (byName.length === 0 && bySlug.length === 0) {
    console.log("[dupes] no duplicates — `prisma db push` should succeed.");
    return;
  }

  // How often is each duplicate actually referenced? Device models are not a
  // relation — they are referenced by id INSIDE JSON: frozen order lines carry
  // `breakdown: [{ modelId, qty }]`. Those snapshots are exactly what must not
  // be orphaned, so that is what we count.
  const suspectIds = new Set(
    [...byName, ...bySlug].flatMap(([, rows]) => rows.map((r) => r.id)),
  );
  const usage = new Map([...suspectIds].map((id) => [id, 0]));
  try {
    const orders = await prisma.order.findMany({
      select: { items: true },
    });
    for (const order of orders) {
      const items = Array.isArray(order.items) ? order.items : [];
      for (const item of items) {
        const breakdown = Array.isArray(item?.breakdown) ? item.breakdown : [];
        for (const part of breakdown) {
          const id = part?.modelId;
          if (typeof id === "string" && usage.has(id)) {
            usage.set(id, (usage.get(id) ?? 0) + 1);
          }
        }
      }
    }
  } catch (error) {
    console.log(`[dupes] (could not scan orders: ${error.message})`);
  }

  const report = (label, groups) => {
    if (groups.length === 0) return;
    console.log(`\n[dupes] duplicate ${label} — ${groups.length} group(s):`);
    for (const [key, rows] of groups) {
      console.log(`\n  "${key}"`);
      for (const row of rows) {
        const used = usage.get(row.id);
        console.log(
          `    id=${row.id}  slug=${row.slug}  brand=${row.brandName ?? "-"}  ` +
            `status=${row.status}  created=${row.createdAt.toISOString().slice(0, 10)}` +
            (used === undefined ? "" : `  usedInOrderLines=${used}`),
        );
      }
    }
  };

  report("names", byName);
  report("slugs", bySlug);

  console.log(
    "\n[dupes] To fix: in the admin panel (Device models), keep the row with " +
      "usedInOrderLines > 0, rename or delete the other, then re-run " +
      "`prisma db push`.\n" +
      "        If BOTH are used, RENAME one (e.g. add the storage size) rather " +
      "than deleting — deleting would orphan frozen order lines.\n" +
      "        If NEITHER is used, either one can go.",
  );
}

main()
  .catch((error) => {
    console.error("[dupes] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
