/**
 * Re-cut product thumbnails at the current quality budget.
 *
 * WHY THIS EXISTS: thumbnails used to be capped at 400px / ~0.1 MB, chosen to
 * protect an image-optimisation quota that no longer applies. A storefront
 * card is ~45vw on a phone and ~22vw on a desktop — roughly 580 and 630
 * DEVICE pixels once screen density is counted — so every card in the
 * catalogue was upscaling a 400px image. src/lib/image.ts now cuts 800px
 * thumbs for new uploads; this brings the existing catalogue up to the same
 * standard by re-cutting from each image's stored full-size version.
 *
 * The full-size images themselves CANNOT be improved: the original never
 * leaves the browser, so whatever was lost at upload time is gone. This only
 * fixes the thumbnails, which is what cards, rails and search results show.
 *
 * SAFETY:
 *  - Dry run by default. Nothing is written without --apply.
 *  - Never overwrites an object. Each new thumbnail goes to a FRESH key and
 *    the old one is left in storage, so a bad run is undone by restoring the
 *    previous thumbUrl values (printed with --verbose).
 *  - Skips anything it cannot fetch or decode, and reports it.
 *
 * Run (dry run, against whichever database DATABASE_URL points at):
 *   npx tsx scripts/rebuild-thumbnails.ts
 *   npx tsx scripts/rebuild-thumbnails.ts --limit 5 --apply --verbose
 *   npx tsx scripts/rebuild-thumbnails.ts --apply
 *
 * `sharp` comes in with Next.js rather than as a direct dependency; this is a
 * local maintenance script, so that is fine, but it is why it is not imported
 * anywhere in src/.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";

/** Matches THUMB_MAX_DIMENSION in src/lib/image.ts. */
const THUMB_MAX_DIMENSION = 800;
/** Encoder quality. Comparable to THUMB_INITIAL_QUALITY in the browser path. */
const THUMB_QUALITY = 85;

function loadDotEnv() {
  try {
    const txt = readFileSync(path.join(process.cwd(), ".env"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let v = m[2];
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch {
    /* no .env — env is expected to be supplied inline */
  }
}
loadDotEnv();

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const VERBOSE = args.includes("--verbose");
const LIMIT = (() => {
  const at = args.indexOf("--limit");
  if (at === -1) return Infinity;
  const n = Number(args[at + 1]);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
})();

const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL ?? "").replace(/\/+$/, "");
const R2_BUCKET = process.env.R2_BUCKET ?? "";

const prisma = new PrismaClient();

function r2Client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

interface Outcome {
  productId: string;
  name: string;
  index: number;
  from: string | null;
  to?: string;
  beforeBytes?: number;
  afterBytes?: number;
  width?: number;
  skipped?: string;
}

async function main() {
  if (!R2_PUBLIC_URL || !R2_BUCKET) {
    console.error(
      "R2_PUBLIC_URL and R2_BUCKET must be set (inline, or in .env).",
    );
    process.exit(1);
  }

  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, images: true },
  });

  const client = APPLY ? r2Client() : null;
  const results: Outcome[] = [];
  let done = 0;

  for (const product of products) {
    if (done >= LIMIT) break;
    if (product.images.length === 0) continue;

    const nextImages = [...product.images];
    let changed = false;

    for (const [index, image] of product.images.entries()) {
      if (done >= LIMIT) break;
      const outcome: Outcome = {
        productId: product.id,
        name: product.name,
        index,
        from: image.thumbUrl ?? null,
      };

      // Root-relative seed images are not ours to re-cut.
      if (!image.url.startsWith("http")) {
        outcome.skipped = "not on object storage";
        results.push(outcome);
        continue;
      }

      let source: Buffer;
      try {
        const res = await fetch(image.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        source = Buffer.from(await res.arrayBuffer());
      } catch (error) {
        outcome.skipped = `could not fetch full size (${
          error instanceof Error ? error.message : "unknown"
        })`;
        results.push(outcome);
        continue;
      }

      let body: Buffer;
      let contentType: string;
      let width: number | undefined;
      try {
        const pipeline = sharp(source, { failOn: "none" }).rotate();
        const meta = await pipeline.metadata();
        // Never upscale: a thumbnail wider than its source is just a bigger
        // file showing the same detail.
        const target = Math.min(
          THUMB_MAX_DIMENSION,
          Math.max(meta.width ?? 0, meta.height ?? 0) || THUMB_MAX_DIMENSION,
        );
        const resized = pipeline.resize({
          width: target,
          height: target,
          fit: "inside",
          withoutEnlargement: true,
        });
        // Keep PNG for anything with transparency; a flattened logo looks
        // worse than a slightly larger file.
        if (meta.hasAlpha) {
          body = await resized.png({ compressionLevel: 9 }).toBuffer();
          contentType = "image/png";
        } else {
          body = await resized
            .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
            .toBuffer();
          contentType = "image/jpeg";
        }
        const outMeta = await sharp(body).metadata();
        width = outMeta.width;
      } catch (error) {
        outcome.skipped = `could not decode (${
          error instanceof Error ? error.message : "unknown"
        })`;
        results.push(outcome);
        continue;
      }

      const key = `products/thumb-${randomUUID()}.${
        contentType === "image/png" ? "png" : "jpg"
      }`;
      outcome.to = `${R2_PUBLIC_URL}/${key}`;
      outcome.afterBytes = body.byteLength;
      outcome.width = width;

      if (image.thumbUrl) {
        try {
          const head = await fetch(image.thumbUrl, { method: "HEAD" });
          const len = head.headers.get("content-length");
          if (len) outcome.beforeBytes = Number(len);
        } catch {
          /* size comparison is a nicety, not a requirement */
        }
      }

      if (APPLY && client) {
        await client.send(
          new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: key,
            Body: body,
            ContentType: contentType,
            CacheControl: "public, max-age=31536000, immutable",
          }),
        );
        nextImages[index] = { ...image, thumbUrl: outcome.to };
        changed = true;
      }

      results.push(outcome);
      done += 1;
    }

    if (APPLY && changed) {
      await prisma.product.update({
        where: { id: product.id },
        data: { images: nextImages },
      });
    }
  }

  const rebuilt = results.filter((r) => !r.skipped);
  const skipped = results.filter((r) => r.skipped);

  if (VERBOSE) {
    for (const r of results) {
      if (r.skipped) {
        console.log(`SKIP  ${r.name} [${r.index}] — ${r.skipped}`);
      } else {
        console.log(
          `${APPLY ? "DONE" : "WOULD"}  ${r.name} [${r.index}] ` +
            `${r.width}px ${kb(r.afterBytes)}` +
            (r.beforeBytes ? ` (was ${kb(r.beforeBytes)})` : "") +
            `\n      old: ${r.from ?? "(none)"}\n      new: ${r.to}`,
        );
      }
    }
  }

  console.log(
    `\n${APPLY ? "Rebuilt" : "Would rebuild"} ${rebuilt.length} thumbnail(s)` +
      `, skipped ${skipped.length}.`,
  );
  if (!APPLY) {
    console.log("Dry run — nothing was written. Re-run with --apply.");
  }
  await prisma.$disconnect();
}

function kb(bytes?: number): string {
  if (!bytes) return "?";
  return `${Math.round(bytes / 1024)} KB`;
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
