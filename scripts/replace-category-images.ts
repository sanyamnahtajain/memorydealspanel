/**
 * Replace category images from a local folder of files named by category slug
 * (e.g. `power-banks.jpg`). For each: upload to R2 at a fresh key, relink the
 * category, then DELETE the previously-linked R2 object.
 *
 * Run:
 *   IMG_DIR="/path/to/category-images" DATABASE_URL="mongodb+srv://.../memorydeals?..." \
 *     npx tsx scripts/replace-category-images.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

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
const R2_HOST = (() => { try { return new URL(R2_PUBLIC_URL).host; } catch { return ""; } })();
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "" },
});

const IMG_DIR = process.env.IMG_DIR ?? "/Users/master/Documents/Playground/category-images";

const CT: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

/** R2 object key from a public URL, if it belongs to our bucket host. */
function keyFromPublicUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.host !== R2_HOST) return null;
    const key = u.pathname.replace(/^\/+/, "");
    // Safety: only ever delete under our known image prefixes.
    if (key.startsWith("seed/categories/") || key.startsWith("categories/")) return key;
    return null;
  } catch {
    return null;
  }
}

async function main() {
  if (!R2_PUBLIC_URL || !process.env.R2_ACCESS_KEY_ID) throw new Error("R2 not configured in .env");

  const files = readdirSync(IMG_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  console.log(`Found ${files.length} image files in ${IMG_DIR}`);

  let replaced = 0;
  let deleted = 0;
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const slug = path.basename(file, ext);
    const category = await prisma.category.findUnique({ where: { slug }, select: { id: true, name: true, image: true } });
    if (!category) {
      console.log(`✗ ${file}: no category with slug "${slug}" — skipped`);
      continue;
    }

    const oldKey = keyFromPublicUrl(category.image);
    const newKey = `categories/${slug}${ext}`;
    const body = readFileSync(path.join(IMG_DIR, file));

    await s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: newKey, Body: body, ContentType: CT[ext] ?? "image/jpeg" }));
    const publicUrl = `${R2_PUBLIC_URL}/${newKey}`;
    await prisma.category.update({ where: { id: category.id }, data: { image: publicUrl } });
    replaced++;

    if (oldKey && oldKey !== newKey) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: oldKey }));
        deleted++;
        console.log(`✓ ${category.name} → ${newKey}  (removed old ${oldKey})`);
      } catch (e) {
        console.log(`✓ ${category.name} → ${newKey}  (old delete failed: ${String(e).slice(0, 50)})`);
      }
    } else {
      console.log(`✓ ${category.name} → ${newKey}`);
    }
  }

  console.log(`\nDone. Relinked ${replaced} categories, deleted ${deleted} old objects.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
