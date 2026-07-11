/**
 * Product seed from the supplier price lists (realme / OnePlus / boAt).
 *
 * Idempotent (upsert by slug). Prices are whole rupees → integer paise. Each
 * product is mapped to a seeded category by keyword. Ensures the OnePlus brand
 * exists (realme + boAt were seeded earlier). Products are created WITHOUT
 * images — add real photos via the admin editor / bulk upload / CSV image URLs.
 *
 * Run:
 *   DATABASE_URL="mongodb+srv://.../memorydeals?..." npx tsx scripts/seed-products.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

function loadDotEnv() {
  try {
    const txt = readFileSync(path.join(process.cwd(), ".env"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch { /* ignore */ }
}
loadDotEnv();

const prisma = new PrismaClient();
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL ?? "").replace(/\/+$/, "");
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "" },
});

async function fetchToR2(sourceUrl: string, key: string): Promise<string | null> {
  try {
    const res = await fetch(sourceUrl, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 seed" }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get("content-type") ?? "image/png";
    if (!ct.startsWith("image/")) throw new Error(`not an image (${ct})`);
    const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
    const body = Buffer.from(await res.arrayBuffer());
    if (body.byteLength < 256) throw new Error("tiny image");
    const fullKey = `${key}.${ext}`;
    await s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: fullKey, Body: body, ContentType: ct }));
    return `${R2_PUBLIC_URL}/${fullKey}`;
  } catch (e) {
    console.warn(`  ! logo failed ${key}: ${String(e).slice(0, 60)}`);
    return null;
  }
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Keyword → category slug (falls back to earphones). */
function categorySlugFor(name: string): string {
  const n = name.toUpperCase();
  if (n.includes("WATCH")) return "smart-watches";
  if (n.includes("CABLE")) return "cables";
  if (n.includes("ADAPTOR") || n.includes("ADAPTER") || n.includes("CHARGER") || n.includes("DOCK")) return "chargers";
  return "earphones-headsets";
}

interface Item { model: string; price: number }
interface BrandGroup { slug: string; display: string; domain: string; prefix: string; items: Item[] }

const GROUPS: BrandGroup[] = [
  {
    slug: "realme", display: "realme", domain: "realme.com", prefix: "RLM",
    items: [
      { model: "T110", price: 1140 }, { model: "T200 Lite", price: 1100 }, { model: "T200 X", price: 1150 },
      { model: "T200", price: 1390 }, { model: "T310", price: 1590 }, { model: "Buds T500 Pro", price: 2390 },
      { model: "Air 7", price: 2340 }, { model: "Air 8", price: 3080 }, { model: "Buds Air 7 Pro", price: 3950 },
      { model: "Air 8 Pro", price: 5450 }, { model: "Wireless 5 Lite", price: 950 }, { model: "Buds Wireless 3 Neo", price: 950 },
      { model: "Buds Wireless 3", price: 1390 }, { model: "Buds Wireless 5 ANC", price: 1390 },
      { model: "Watch S2 (with Strap)", price: 2900 }, { model: "Watch 5", price: 3550 },
      { model: "SuperVOOC 45W Adaptor", price: 730 }, { model: "80W Dock", price: 1540 },
      { model: "2-in-1 1.5M 3Amp Cable", price: 260 }, { model: "SuperVOOC Cable", price: 250 },
      { model: "Buds 3 Aux Earphone", price: 490 }, { model: "Buds 3 Type-C Earphone", price: 540 },
    ],
  },
  {
    slug: "oneplus", display: "OnePlus", domain: "oneplus.com", prefix: "OP",
    items: [
      { model: "Nord Buds 3R", price: 1540 }, { model: "Nord Buds 3", price: 1970 }, { model: "Nord Buds 4 Pro", price: 3600 },
      { model: "Nord Buds 3 Pro", price: 2490 }, { model: "Buds 3", price: 4200 }, { model: "Buds 4", price: 5400 },
      { model: "Z2 ANC Neckband", price: 1730 }, { model: "Z3 Neckband", price: 1390 }, { model: "80W Adaptor", price: 1600 },
      { model: "100W Charger", price: 2050 }, { model: "Cable USB to C", price: 640 }, { model: "C to C Cable", price: 640 },
    ],
  },
  {
    slug: "boat", display: "boAt", domain: "boat-lifestyle.com", prefix: "BT",
    items: [
      { model: "Ace", price: 740 }, { model: "Joy", price: 740 }, { model: "91", price: 790 }, { model: "71", price: 790 },
      { model: "Airdopes 161/163", price: 790 }, { model: "Pulse", price: 790 }, { model: "213", price: 790 },
      { model: "138/131 Gen 2", price: 790 }, { model: "138/131", price: 690 }, { model: "Ace Gen 2", price: 830 },
      { model: "219", price: 790 }, { model: "Immortal 100", price: 875 }, { model: "Immortal 121", price: 840 },
      { model: "Immortal 141", price: 840 }, { model: "Immortal Katana", price: 1390 }, { model: "170 ANC", price: 910 },
      { model: "141 Elite ANC", price: 1050 }, { model: "131 Elite ANC", price: 1050 }, { model: "513 ANC", price: 1200 },
      { model: "Ultra Pro", price: 1230 }, { model: "161 ANC Elite", price: 1240 }, { model: "701 ANC", price: 1710 },
      { model: "Nirvana Lucid", price: 1410 }, { model: "Nirvana Crystal", price: 1550 }, { model: "Nirvana Crown", price: 2180 },
      { model: "Nirvana Zenith Pro", price: 2380 }, { model: "311 Pro", price: 810 }, { model: "Drift", price: 1020 },
    ],
  },
];

async function main() {
  // Category slug → id.
  const cats = await prisma.category.findMany({ select: { id: true, slug: true } });
  const catBySlug = new Map(cats.map((c) => [c.slug, c.id]));
  const need = new Set(["earphones-headsets", "cables", "chargers", "smart-watches"]);
  for (const s of need) if (!catBySlug.has(s)) throw new Error(`Missing category '${s}' — run seed-prod-data first.`);

  let created = 0;
  let updated = 0;
  const seenSlugs = new Set<string>();

  for (const g of GROUPS) {
    // Ensure the brand exists (create OnePlus with a logo; realme/boAt exist).
    let brand = await prisma.brand.findUnique({ where: { slug: g.slug } });
    if (!brand) {
      const logo = await fetchToR2(`https://icons.duckduckgo.com/ip3/${g.domain}.ico`, `seed/brands/${g.slug}`);
      brand = await prisma.brand.create({ data: { name: g.display, slug: g.slug, logo, status: "ACTIVE", sortOrder: 99 } });
      console.log(`+ brand ${g.display}${logo ? " (logo)" : ""}`);
    }

    let i = 0;
    for (const it of g.items) {
      i++;
      const name = `${g.display} ${it.model}`;
      const slug = slugify(name);
      if (seenSlugs.has(slug)) continue; // dedupe (e.g. boAt 701 ANC listed twice)
      seenSlugs.add(slug);
      const sku = `${g.prefix}-${String(i).padStart(3, "0")}`;
      const categoryId = catBySlug.get(categorySlugFor(name))!;
      const pricePaise = it.price * 100;

      const existing = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
      await prisma.product.upsert({
        where: { slug },
        create: {
          name, slug, sku, brand: g.display, brandId: brand.id, categoryId,
          price: pricePaise, status: "ACTIVE", stockStatus: "IN_STOCK",
          // Set explicitly: Prisma+MongoDB's `{ deletedAt: null }` filter (used by
          // every storefront query) does NOT match an ABSENT field — only an
          // explicit null. Leaving it unset hides the product everywhere.
          deletedAt: null,
        },
        update: {
          name, brand: g.display, brandId: brand.id, categoryId,
          price: pricePaise, status: "ACTIVE", deletedAt: null,
        },
      });
      if (existing) updated++; else created++;
    }
    console.log(`✓ ${g.display}: ${g.items.length} items processed.`);
  }

  const total = await prisma.product.count();
  console.log(`\nDone. Created ${created}, updated ${updated}. DB now has ${total} products.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
