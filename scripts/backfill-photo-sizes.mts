/**
 * Record each product photo's pixel size (width/height on ProductImage) from a
 * measured audit, so the admin can flag photos too small to look sharp.
 * Touches ONLY width/height of images whose URL matches; backs up first.
 *   npx tsx scripts/backfill-photo-sizes.mts <audit.json>
 *   npx tsx scripts/backfill-photo-sizes.mts --restore <backup.json>
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const [flag, file] = process.argv.slice(2);
if (flag === "--restore") {
  const rows = JSON.parse(readFileSync(file, "utf8")).products as { id: string; images: never }[];
  for (const r of rows) await p.product.update({ where: { id: r.id }, data: { images: { set: r.images } } });
  console.log(`restored ${rows.length}`);
} else {
  const audit = JSON.parse(readFileSync(flag, "utf8")) as { url: string; w: number; h: number }[];
  const size = new Map(audit.filter((a) => a.w > 0 && a.h > 0).map((a) => [a.url, { width: a.w, height: a.h }]));
  const rows = await p.product.findMany({ where: { deletedAt: null }, select: { id: true, images: true } });
  const touched = rows.filter((r) => r.images.some((img) => size.has(img.url)));
  mkdirSync(".backups", { recursive: true });
  const backup = `.backups/photo-sizes-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(backup, JSON.stringify({ takenAt: new Date(), products: touched.map((r) => ({ id: r.id, images: r.images })) }));
  console.log("backup:", backup);
  let n = 0;
  for (let i = 0; i < touched.length; i += 50) {
    const batch = touched.slice(i, i + 50);
    await p.$transaction(batch.map((r) => p.product.update({
      where: { id: r.id },
      data: { images: { set: r.images.map((img) => ({ ...img, ...(size.get(img.url) ?? {}) })) } },
    })));
    n += batch.length;
  }
  console.log(`recorded sizes on ${n} products (${size.size} photos measured)`);
}
await p.$disconnect();
