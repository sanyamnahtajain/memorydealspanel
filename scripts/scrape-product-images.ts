/**
 * Scrape product photos from DuckDuckGo image search, upload to R2, and link
 * them on each product (multiple images per product; first = primary).
 *
 * Best-effort: a product that yields no usable image is left as-is and logged.
 * Idempotent-ish: products that already have images are skipped unless FORCE=1.
 * Use LIMIT=<n> for a small test run first.
 *
 * Run:
 *   DATABASE_URL="mongodb+srv://.../memorydeals?..." LIMIT=3 npx tsx scripts/scrape-product-images.ts
 *   DATABASE_URL="..." npx tsx scripts/scrape-product-images.ts        # all remaining
 */
import { readFileSync, appendFileSync } from "node:fs";
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

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const IMAGES_PER_PRODUCT = 3;
const MIN_DIM = 400;
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;
const FORCE = process.env.FORCE === "1";
// Sharding: run N workers in parallel, each taking every Nth pending product
// (i % WORKER_COUNT === WORKER_INDEX). Disjoint + complete, so no two workers
// scrape the same product. Defaults to a single worker.
const WORKER_COUNT = Math.max(1, parseInt(process.env.WORKER_COUNT ?? "1", 10));
const WORKER_INDEX = Math.min(
  WORKER_COUNT - 1,
  Math.max(0, parseInt(process.env.WORKER_INDEX ?? "0", 10)),
);
const WORKER_TAG = WORKER_COUNT > 1 ? `[w${WORKER_INDEX}] ` : "";
/**
 * Deterministic shard for a product, from a stable key (slug). Unlike an index
 * into a per-worker "pending" list (which differs by fetch timing), a hash maps
 * each product to exactly ONE worker regardless of when the list was read — so
 * parallel workers never overlap.
 */
function shardOf(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % WORKER_COUNT;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface DdgResult { image: string; width: number; height: number }

async function ddgSearch(query: string): Promise<DdgResult[]> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const tokRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
        headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000),
      });
      const tokHtml = await tokRes.text();
      const m = tokHtml.match(/vqd="([\d-]+)"/);
      if (!m) throw new Error("no vqd");
      const jsRes = await fetch(`https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${m[1]}&f=,,,&p=1`, {
        headers: { "user-agent": UA, referer: "https://duckduckgo.com/" }, signal: AbortSignal.timeout(20000),
      });
      const json = JSON.parse(await jsRes.text());
      return (json.results ?? []).map((r: { image: string; width: number; height: number }) => ({ image: r.image, width: r.width, height: r.height }));
    } catch {
      await sleep(1200 * attempt);
    }
  }
  return [];
}

async function downloadImage(url: string): Promise<{ buf: Buffer; ct: string } | null> {
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "user-agent": UA, accept: "image/*,*/*" }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 3000) return null; // skip tiny/placeholder
    return { buf, ct };
  } catch {
    return null;
  }
}

function extFor(ct: string): string {
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  return "jpg";
}

const DESCRIPTOR: Record<string, string> = {
  "earphones-headsets": "earbuds",
  chargers: "charger",
  cables: "cable",
  "smart-watches": "smartwatch",
};

// Persistent progress log — every processed product is appended here with a
// timestamp, so progress survives across runs and can be tailed live.
const LOG_FILE = path.join(process.cwd(), "scripts", "scrape-product-images.progress.log");
function log(msg: string) {
  const line = `${new Date().toISOString()} ${WORKER_TAG}${msg}`;
  console.log(line);
  try {
    appendFileSync(LOG_FILE, line + "\n");
  } catch {
    /* logging is best-effort */
  }
}

async function main() {
  if (!R2_PUBLIC_URL || !process.env.R2_ACCESS_KEY_ID) throw new Error("R2 not configured in .env");

  const products = await prisma.product.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: { id: true, name: true, slug: true, images: true, category: { select: { slug: true } } },
    orderBy: { createdAt: "asc" },
  });
  const allPending = FORCE ? products : products.filter((p) => p.images.length === 0);
  // Take this worker's shard — hashed by slug so it's disjoint across workers
  // even though each fetched `allPending` at a slightly different moment.
  const pending =
    WORKER_COUNT > 1
      ? allPending.filter((p) => shardOf(p.slug) === WORKER_INDEX)
      : allPending;
  log(`# run start — ${products.length} products, ${allPending.length} pending, this worker ${pending.length} (shard ${WORKER_INDEX + 1}/${WORKER_COUNT})`);

  let done = 0;
  let withImages = 0;
  let failed = 0;

  for (const p of pending) {
    if (done >= LIMIT) break;
    done++;

    const descriptor = DESCRIPTOR[p.category.slug] ?? "";
    const query = `${p.name} ${descriptor}`.trim();
    const results = await ddgSearch(query);
    const candidates = results.filter((r) => r.width >= MIN_DIM && r.height >= MIN_DIM);

    const uploaded: { url: string; thumbUrl: string; sortOrder: number; isPrimary: boolean }[] = [];
    for (const c of candidates) {
      if (uploaded.length >= IMAGES_PER_PRODUCT) break;
      const dl = await downloadImage(c.image);
      if (!dl) continue;
      const key = `products/${p.slug}/${uploaded.length + 1}.${extFor(dl.ct)}`;
      try {
        await s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, Body: dl.buf, ContentType: dl.ct }));
      } catch {
        continue;
      }
      const publicUrl = `${R2_PUBLIC_URL}/${key}`;
      uploaded.push({ url: publicUrl, thumbUrl: publicUrl, sortOrder: uploaded.length, isPrimary: uploaded.length === 0 });
      // Persist to Atlas immediately after EACH image — don't wait for the rest,
      // so R2 and the DB stay in lock-step and a crash never loses work.
      try {
        await prisma.product.update({ where: { id: p.id }, data: { images: uploaded } });
      } catch {
        /* keep going; the next image write will retry the array */
      }
      await sleep(120);
    }

    if (uploaded.length > 0) {
      withImages++;
      log(`✓ ${done}/${pending.length} ${p.slug} — ${uploaded.length} image(s)`);
    } else {
      failed++;
      log(`✗ ${done}/${pending.length} ${p.slug} — no usable image (${results.length} raw / ${candidates.length} ok)`);
    }
    await sleep(700); // be polite to DDG
  }

  log(`# run done — processed ${done}, imaged ${withImages}, failed ${failed}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
