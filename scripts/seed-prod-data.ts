/**
 * PRODUCTION data seed (one-off).
 *
 * Populates a fresh deployment with real, usable master data:
 *   - RBAC roles (Owner / Catalog Manager / Sales)
 *   - the Owner admin (from ADMIN_EMAIL / ADMIN_PASSWORD env)
 *   - the SellerTaxProfile singleton (GST OFF by default)
 *   - product categories (with images + sensible HSN / 18% GST defaults)
 *   - brands (with logos)
 *
 * Images are DOWNLOADED from the internet and UPLOADED to Cloudflare R2, then
 * the public URL is stored on the record. Category photos come from a keyword
 * stock source (loremflickr, CC) and brand logos from the Clearbit Logo API —
 * both are placeholders you should review/replace in the admin editor. A failed
 * image download never blocks the record (it is just left without an image).
 *
 * It does NOT seed products — import your real catalog via the admin CSV import.
 *
 * Run (DATABASE_URL = the Atlas prod string incl. /memorydeals; R2_* come from
 * .env):
 *   DATABASE_URL="mongodb+srv://.../memorydeals?..." \
 *   ADMIN_EMAIL="nahtasanyam@gmail.com" ADMIN_PASSWORD="Tmd@2016" ADMIN_NAME="Sanyam" \
 *   npx tsx scripts/seed-prod-data.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// tsx does not auto-load .env — pull R2_* (and anything else not already set)
// from the project .env so the S3 client is configured.
function loadDotEnv() {
  try {
    const txt = readFileSync(path.join(process.cwd(), ".env"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let val = m[2];
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
  } catch {
    /* no .env — rely on the ambient environment */
  }
}
loadDotEnv();

const prisma = new PrismaClient();

const R2_BUCKET = process.env.R2_BUCKET ?? "memorydeals-images";
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL ?? "").replace(/\/+$/, "");
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  },
});

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env ${name}.`);
  return v;
}

/** Download → R2 upload → return the public URL, or null on any failure. */
async function fetchToR2(
  sourceUrl: string,
  key: string,
): Promise<string | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(sourceUrl, {
        redirect: "follow",
        headers: { "user-agent": "Mozilla/5.0 memorydeals-seed" },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get("content-type") ?? "image/jpeg";
      if (!contentType.startsWith("image/")) {
        throw new Error(`not an image (${contentType})`);
      }
      const ext = contentType.includes("png")
        ? "png"
        : contentType.includes("webp")
          ? "webp"
          : "jpg";
      const body = Buffer.from(await res.arrayBuffer());
      if (body.byteLength < 512) throw new Error("suspiciously tiny image");
      const fullKey = `${key}.${ext}`;
      await s3.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: fullKey,
          Body: body,
          ContentType: contentType,
        }),
      );
      return `${R2_PUBLIC_URL}/${fullKey}`;
    } catch (err) {
      if (attempt === 3) {
        console.warn(
          `  ! image failed for ${key}: ${String(err).slice(0, 80)}`,
        );
        return null;
      }
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
  return null;
}

const CATEGORIES = [
  { name: "Chargers", slug: "chargers", keyword: "phone,charger", hsn: "8504", sort: 1 },
  { name: "Cables", slug: "cables", keyword: "usb,cable", hsn: "8544", sort: 2 },
  { name: "Power Banks", slug: "power-banks", keyword: "power,bank", hsn: "8507", sort: 3 },
  { name: "Earphones & Headsets", slug: "earphones-headsets", keyword: "earphones", hsn: "8518", sort: 4 },
  { name: "Bluetooth Speakers", slug: "bluetooth-speakers", keyword: "bluetooth,speaker", hsn: "8518", sort: 5 },
  { name: "Mobile Cases & Covers", slug: "cases-covers", keyword: "phone,case", hsn: "3926", sort: 6 },
  { name: "Screen Protectors", slug: "screen-protectors", keyword: "smartphone,screen", hsn: "3919", sort: 7 },
  { name: "Car Accessories", slug: "car-accessories", keyword: "car,phone,mount", hsn: "8708", sort: 8 },
  { name: "Memory Cards", slug: "memory-cards", keyword: "memory,card", hsn: "8523", sort: 9 },
  { name: "Smart Watches", slug: "smart-watches", keyword: "smartwatch", hsn: "8517", sort: 10 },
  { name: "Adapters & Converters", slug: "adapters-converters", keyword: "adapter,plug", hsn: "8504", sort: 11 },
  { name: "Tripods & Selfie Sticks", slug: "tripods-selfie-sticks", keyword: "tripod", hsn: "9620", sort: 12 },
];

const BRANDS = [
  { name: "boAt", slug: "boat", domain: "boat-lifestyle.com" },
  { name: "Samsung", slug: "samsung", domain: "samsung.com" },
  { name: "Portronics", slug: "portronics", domain: "portronics.com" },
  { name: "Ambrane", slug: "ambrane", domain: "ambraneindia.com" },
  { name: "Mi", slug: "mi", domain: "mi.com" },
  { name: "realme", slug: "realme", domain: "realme.com" },
  { name: "JBL", slug: "jbl", domain: "jbl.com" },
  { name: "pTron", slug: "ptron", domain: "ptron.in" },
  { name: "Zebronics", slug: "zebronics", domain: "zebronics.com" },
  { name: "Noise", slug: "noise", domain: "gonoise.com" },
  { name: "Spigen", slug: "spigen", domain: "spigen.com" },
  { name: "Boult", slug: "boult", domain: "boultaudio.com" },
];

async function seedRolesAndAdmin() {
  const adminEmail = requireEnv("ADMIN_EMAIL").toLowerCase();
  const adminPassword = requireEnv("ADMIN_PASSWORD");
  const adminName = process.env.ADMIN_NAME?.trim() || "Owner";
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const ownerRole = await prisma.role.upsert({
    where: { name: "Owner" },
    create: { name: "Owner", description: "Full access to everything. Cannot be edited or deleted.", permissions: ["*"], isSystem: true },
    update: { permissions: ["*"], isSystem: true },
  });
  await prisma.role.upsert({
    where: { name: "Catalog Manager" },
    create: { name: "Catalog Manager", description: "Manages the product catalog, categories, brands, and imports/exports.", permissions: ["products.view", "products.edit", "products.delete", "categories.manage", "brands.manage", "import.run", "export.data", "dashboard.view"], isSystem: false },
    update: {},
  });
  await prisma.role.upsert({
    where: { name: "Sales" },
    create: { name: "Sales", description: "Handles customers and access requests; read-only on the catalog.", permissions: ["products.view", "customers.view", "customers.approve", "customers.edit", "customers.block", "dashboard.view"], isSystem: false },
    update: {},
  });
  await prisma.admin.upsert({
    where: { email: adminEmail },
    create: { email: adminEmail, passwordHash, name: adminName, totpSecret: null, isActive: true, roleId: ownerRole.id },
    update: { passwordHash, name: adminName, isActive: true, roleId: ownerRole.id },
  });
  console.log(`✓ Roles + admin (${adminEmail}) seeded.`);
}

async function seedTaxProfile() {
  await prisma.sellerTaxProfile.upsert({
    where: { key: "default" },
    create: { key: "default", gstEnabled: false, priceEntryMode: "TAX_EXCLUSIVE", displayMode: "EXCLUSIVE", roundingMode: "LINE", defaultGstRateBps: 1800, defaultHsnCode: null },
    update: {},
  });
  console.log("✓ SellerTaxProfile seeded (GST off, default 18%).");
}

async function seedCategories() {
  let withImage = 0;
  for (const c of CATEGORIES) {
    const image = await fetchToR2(
      `https://loremflickr.com/640/640/${encodeURIComponent(c.keyword)}`,
      `seed/categories/${c.slug}`,
    );
    if (image) withImage++;
    await prisma.category.upsert({
      where: { slug: c.slug },
      create: { name: c.name, slug: c.slug, image, sortOrder: c.sort, status: "ACTIVE", defaultHsnCode: c.hsn, defaultGstRateBps: 1800 },
      update: { name: c.name, sortOrder: c.sort, defaultHsnCode: c.hsn, defaultGstRateBps: 1800, ...(image ? { image } : {}) },
    });
    console.log(`  • ${c.name}${image ? " (image)" : ""}`);
  }
  console.log(`✓ ${CATEGORIES.length} categories seeded (${withImage} with images).`);
}

async function seedBrands() {
  let withLogo = 0;
  for (let i = 0; i < BRANDS.length; i++) {
    const b = BRANDS[i];
    // DuckDuckGo icon proxy — real brand marks, reachable (Clearbit is blocked
    // from some networks). Favicon-resolution; replace with hi-res in admin.
    const logo = await fetchToR2(
      `https://icons.duckduckgo.com/ip3/${b.domain}.ico`,
      `seed/brands/${b.slug}`,
    );
    if (logo) withLogo++;
    await prisma.brand.upsert({
      where: { slug: b.slug },
      create: { name: b.name, slug: b.slug, logo, status: "ACTIVE", sortOrder: i + 1 },
      update: { name: b.name, sortOrder: i + 1, ...(logo ? { logo } : {}) },
    });
    console.log(`  • ${b.name}${logo ? " (logo)" : ""}`);
  }
  console.log(`✓ ${BRANDS.length} brands seeded (${withLogo} with logos).`);
}

async function main() {
  if (!R2_PUBLIC_URL || !process.env.R2_ACCESS_KEY_ID) {
    throw new Error("R2 is not configured (need R2_PUBLIC_URL + R2 creds in .env).");
  }
  console.log("Seeding production data → " + R2_PUBLIC_URL);
  await seedRolesAndAdmin();
  await seedTaxProfile();
  await seedCategories();
  await seedBrands();
  const [cats, brands, admins] = await Promise.all([
    prisma.category.count(),
    prisma.brand.count(),
    prisma.admin.count(),
  ]);
  console.log(`\nDone. DB now has ${cats} categories, ${brands} brands, ${admins} admin(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
