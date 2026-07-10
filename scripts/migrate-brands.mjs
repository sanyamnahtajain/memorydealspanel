// One-time migration: create Brand rows from distinct Product.brand strings and
// set Product.brandId. Idempotent. Run: node scripts/migrate-brands.mjs
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const products = await prisma.product.findMany({
  where: { brand: { not: null } },
  select: { id: true, brand: true, brandId: true },
});
const byLower = new Map(); // lower -> display (first wins)
for (const p of products) {
  const name = (p.brand ?? "").trim();
  if (name && !byLower.has(name.toLowerCase())) byLower.set(name.toLowerCase(), name);
}
const lowerToId = new Map();
const usedSlugs = new Set();
for (const [lower, display] of byLower) {
  let slug = slugify(display) || "brand";
  let n = 2; while (usedSlugs.has(slug)) slug = `${slugify(display)}-${n++}`;
  usedSlugs.add(slug);
  const brand = await prisma.brand.upsert({
    where: { name: display },
    create: { name: display, slug, status: "ACTIVE" },
    update: {},
  });
  lowerToId.set(lower, brand.id);
}
let linked = 0;
for (const p of products) {
  const id = lowerToId.get((p.brand ?? "").trim().toLowerCase());
  if (id && p.brandId !== id) { await prisma.product.update({ where: { id: p.id }, data: { brandId: id } }); linked++; }
}
console.log(`Brands created/kept: ${lowerToId.size} | products linked: ${linked}`);
await prisma.$disconnect();
