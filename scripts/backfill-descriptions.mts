/**
 * Fill every EMPTY product description from the product's own facts
 * (src/lib/product-description.ts). Owner-written descriptions are never
 * touched. Backs up first; `--restore <backup.json>` empties them again.
 *
 *   npx tsx scripts/backfill-descriptions.mts --dry-run
 *   npx tsx scripts/backfill-descriptions.mts
 *   npx tsx scripts/backfill-descriptions.mts --restore .backups/descriptions-….json
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { describeProduct, needsDescription } from "../src/lib/product-description";

const p = new PrismaClient();
const [flag, file] = process.argv.slice(2);

if (flag === "--restore") {
  const rows = JSON.parse(readFileSync(file, "utf8")).products as { id: string; description: string | null }[];
  for (const r of rows) await p.product.update({ where: { id: r.id }, data: { description: r.description } });
  console.log(`restored ${rows.length} descriptions`);
} else {
  const dry = flag === "--dry-run";
  const rows = await p.product.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, description: true, moq: true, packMultiple: true, brand: true, brandRef: { select: { name: true } }, category: { select: { name: true } } },
  });
  const todo = rows.filter((r) => needsDescription(r.description));
  const drafts = todo.map((r) => ({
    id: r.id,
    before: r.description,
    after: describeProduct({ name: r.name, brand: r.brandRef?.name ?? r.brand, category: r.category?.name ?? null, moq: r.moq, packMultiple: r.packMultiple }),
    name: r.name,
  }));
  console.log(`${rows.length} products, ${todo.length} with an empty description, ${rows.length - todo.length} owner-written kept`);
  for (const d of drafts.slice(0, 3)) console.log(`\n— ${d.name}\n${d.after}`);
  if (dry) process.exit(0);

  mkdirSync(".backups", { recursive: true });
  const backup = `.backups/descriptions-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(backup, JSON.stringify({ takenAt: new Date(), products: drafts.map((d) => ({ id: d.id, description: d.before ?? null })) }, null, 1));
  console.log("\nbackup:", backup);

  let done = 0;
  for (let i = 0; i < drafts.length; i += 50) {
    const batch = drafts.slice(i, i + 50);
    await p.$transaction(batch.map((d) => p.product.update({ where: { id: d.id }, data: { description: d.after } })));
    done += batch.length;
  }
  await p.auditLog.create({
    data: { actorType: "SYSTEM", actorId: "backfill-descriptions", action: "product.description.backfill", entity: "Product", entityId: "bulk", diff: { count: done, backup } },
  } as never).catch((e) => console.warn("audit log skipped:", String(e).slice(0, 120)));
  console.log(`wrote ${done} descriptions`);
}
await p.$disconnect();
