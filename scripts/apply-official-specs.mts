/**
 * Apply verified specs (gathered from each brand's OFFICIAL product page) to
 * the live catalogue, and rewrite the auto-written description to include
 * them. Facts only — the research step never copies marketing text.
 *
 *  - specs: set only where the product has none yet;
 *  - description: rewritten only where it is still the auto-written one
 *    (empty, or exactly what describeProduct() wrote without specs) — any
 *    description the owner has edited is left alone;
 *  - backs up first; `--restore <backup.json>` puts everything back.
 *
 *   npx tsx scripts/apply-official-specs.mts --dry-run <results-dir>
 *   npx tsx scripts/apply-official-specs.mts <results-dir>
 *   npx tsx scripts/apply-official-specs.mts --restore .backups/official-specs-….json
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { describeProduct, needsDescription, writerSentences } from "../src/lib/product-description";

type Result = { id: string; status: string; officialName?: string; sourceUrl?: string; specs?: Record<string, unknown> };

const BANNED_KEY = /price|mrp|offer|discount|rating|review|coupon|cashback|emi|deliver|stock|seller/i;
const MAX_SPECS = 12;

export function cleanSpecs(raw: Record<string, unknown> | undefined): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k).replace(/\s+/g, " ").trim().slice(0, 40);
    const value = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!key || !value || BANNED_KEY.test(key) || /₹|rs\.?\s?\d/i.test(value)) continue;
    out[key] = value;
    if (Object.keys(out).length >= MAX_SPECS) break;
  }
  return Object.keys(out).length >= 2 ? out : null;
}

const p = new PrismaClient();
const [flag, arg] = process.argv.slice(2);

if (flag === "--restore") {
  const rows = JSON.parse(readFileSync(arg, "utf8")).products as { id: string; description: string | null; specs: unknown }[];
  for (const r of rows) await p.product.update({ where: { id: r.id }, data: { description: r.description, specs: (r.specs ?? null) as never } });
  console.log(`restored ${rows.length} products`);
} else {
  const dry = flag === "--dry-run";
  const dir = dry ? arg : flag;
  const results: Result[] = readdirSync(dir)
    .filter((f) => f.endsWith(".out.json"))
    .flatMap((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Result[]);
  // Matches a human must confirm first (shop name/code contradicts the page).
  const skipFile = join(dir, "skip.json");
  const held: Record<string, string> = (() => {
    try {
      return JSON.parse(readFileSync(skipFile, "utf8"));
    } catch {
      return {};
    }
  })();
  const found = new Map(
    results
      .filter((r) => r.status === "found")
      .filter((r) => !(((r as Result & { name?: string }).name ?? "") in held))
      .map((r) => [r.id, r]),
  );
  if (Object.keys(held).length) console.log(`held for owner review: ${Object.keys(held).length}`);
  console.log(`${results.length} researched, ${found.size} found on official sites`);

  // Products whose description was auto-filled by scripts/backfill-descriptions.mts.
  const autoFilled = new Set<string>(
    readdirSync(".backups")
      .filter((f) => /^descriptions-.*\.json$/.test(f))
      .flatMap((f) => (JSON.parse(readFileSync(join(".backups", f), "utf8")).products as { id: string }[]).map((x) => x.id)),
  );
  const ours = writerSentences();

  const rows = await p.product.findMany({
    where: { id: { in: [...found.keys()] }, deletedAt: null },
    select: { id: true, name: true, description: true, specs: true, moq: true, packMultiple: true, brand: true, brandRef: { select: { name: true } }, category: { select: { name: true } } },
  });

  const plan = rows.flatMap((row) => {
    const res = found.get(row.id)!;
    const cleaned = cleanSpecs(res.specs);
    // The official model name leads the spec list (and the description).
    const specs = cleaned && res.officialName && !res.officialName.includes("/") ? { Model: res.officialName.trim().slice(0, 80), ...cleaned } : cleaned;
    if (!specs) return [];
    const base = { name: row.name, brand: row.brandRef?.name ?? row.brand, category: row.category?.name ?? null, moq: row.moq, packMultiple: row.packMultiple };
    const hasSpecs = row.specs && typeof row.specs === "object" && !Array.isArray(row.specs) && Object.keys(row.specs).length > 0;
    // Still the writer's own text (filled today, untouched since) — or empty.
    const autoWritten =
      needsDescription(row.description) ||
      row.description === describeProduct(base) ||
      (autoFilled.has(row.id) && ours.some((sentence) => row.description!.includes(sentence)));
    if (hasSpecs && !autoWritten) return [];
    return [{
      id: row.id,
      name: row.name,
      before: { description: row.description, specs: row.specs },
      after: {
        specs: hasSpecs ? null : specs,
        description: autoWritten ? describeProduct({ ...base, specs }) : null,
      },
      source: found.get(row.id)!.sourceUrl,
    }];
  });
  const descCount = plan.filter((x) => x.after.description).length;
  const specCount = plan.filter((x) => x.after.specs).length;
  console.log(`will set specs on ${specCount}, rewrite ${descCount} descriptions (owner-edited left alone)`);
  for (const x of plan.slice(0, 2)) console.log(`\n— ${x.name}  (${x.source})\n${x.after.description ?? "(description kept)"}`);
  if (dry) process.exit(0);

  mkdirSync(".backups", { recursive: true });
  const backup = `.backups/official-specs-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(backup, JSON.stringify({ takenAt: new Date(), products: plan.map((x) => ({ id: x.id, ...x.before, source: x.source })) }, null, 1));
  console.log("\nbackup:", backup);
  for (let i = 0; i < plan.length; i += 50) {
    const batch = plan.slice(i, i + 50);
    await p.$transaction(batch.map((x) => p.product.update({
      where: { id: x.id },
      data: {
        ...(x.after.specs ? { specs: x.after.specs } : {}),
        ...(x.after.description ? { description: x.after.description } : {}),
      },
    })));
  }
  await p.auditLog.create({
    data: { actorType: "SYSTEM", actorId: "apply-official-specs", action: "product.specs.official", entity: "Product", entityId: "bulk", diff: { specs: specCount, descriptions: descCount, backup } },
  });
  console.log(`done: specs on ${specCount}, descriptions ${descCount}`);
}
await p.$disconnect();
