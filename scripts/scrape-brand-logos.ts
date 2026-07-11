/**
 * Scrape brand logos (DuckDuckGo image search "<brand> logo") → upload to R2 →
 * link on the brand. Only brands WITHOUT a logo are processed unless FORCE=1.
 *
 * Run:
 *   DATABASE_URL="mongodb+srv://.../memorydeals?..." npx tsx scripts/scrape-brand-logos.ts
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
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const FORCE = process.env.FORCE === "1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ddgSearch(query: string): Promise<{ image: string; width: number; height: number }[]> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const tok = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
      const m = (await tok.text()).match(/vqd="([\d-]+)"/);
      if (!m) throw new Error("no vqd");
      const js = await fetch(`https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${m[1]}&f=,,,&p=1`, { headers: { "user-agent": UA, referer: "https://duckduckgo.com/" }, signal: AbortSignal.timeout(20000) });
      const json = JSON.parse(await js.text());
      return (json.results ?? []).map((r: { image: string; width: number; height: number }) => ({ image: r.image, width: r.width, height: r.height }));
    } catch { await sleep(1200 * attempt); }
  }
  return [];
}

async function download(url: string): Promise<{ buf: Buffer; ct: string } | null> {
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "user-agent": UA, accept: "image/*,*/*" }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.startsWith("image/") || ct.includes("svg")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 1500) return null;
    return { buf, ct };
  } catch { return null; }
}
const ext = (ct: string) => (ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg");

async function main() {
  if (!R2_PUBLIC_URL || !process.env.R2_ACCESS_KEY_ID) throw new Error("R2 not configured in .env");
  const brands = await prisma.brand.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, slug: true, logo: true }, orderBy: { name: "asc" } });

  let done = 0, ok = 0, fail = 0;
  for (const b of brands) {
    if (!FORCE && b.logo) continue;
    done++;
    const results = await ddgSearch(`${b.name} logo png`);
    // Logos are usually wide/landscape or square; accept anything reasonably sized.
    const candidates = results.filter((r) => r.width >= 150 && r.height >= 80);
    let linked = false;
    for (const c of candidates.slice(0, 8)) {
      const dl = await download(c.image);
      if (!dl) continue;
      const key = `brands/${b.slug}-logo.${ext(dl.ct)}`;
      try {
        await s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, Body: dl.buf, ContentType: dl.ct }));
      } catch { continue; }
      await prisma.brand.update({ where: { id: b.id }, data: { logo: `${R2_PUBLIC_URL}/${key}` } });
      linked = true;
      break;
    }
    if (linked) { ok++; console.log(`✓ ${b.name}`); }
    else { fail++; console.log(`✗ ${b.name} — no logo found`); }
    await sleep(600);
  }
  console.log(`\nDone. Processed ${done} brands: ${ok} logos, ${fail} without.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
