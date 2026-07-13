/**
 * READ-ONLY data integrity audit.
 *
 * Verifies that products + their embedded images are well-formed. Makes NO
 * writes. Uses raw Mongo commands for the checks Prisma cannot express
 * (field-absence — the Atlas `deletedAt: null` gotcha — and per-image URL
 * validity inside the embedded array).
 *
 * Run against a chosen DB, e.g.:
 *   DATABASE_URL="mongodb+srv://…/memorydeals" npx tsx scripts/audit-data.ts
 */

import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();

type CountResult = { n?: number } | null;

async function countRaw(filter: Record<string, unknown>): Promise<number> {
  // Use the aggregation count via $runCommandRaw for exact, index-friendly counts.
  const res = (await prisma.$runCommandRaw({
    count: "Product",
    query: filter,
  } as Prisma.InputJsonObject)) as unknown as CountResult;
  return res?.n ?? 0;
}

async function main() {
  const url = process.env.DATABASE_URL ?? "(unset)";
  const masked = url.replace(/(\/\/[^:]+:)[^@]+(@)/, "$1****$2");
  console.log(`\nAuditing: ${masked}\n`);

  const total = await countRaw({});
  const softDeleted = await countRaw({ deletedAt: { $ne: null } });
  const deletedAtAbsent = await countRaw({ deletedAt: { $exists: false } });
  const statusActive = await countRaw({ status: "ACTIVE" });
  const statusInactive = await countRaw({ status: "INACTIVE" });
  const statusOther = total - statusActive - statusInactive;

  // Image integrity (embedded array).
  const noImages = await countRaw({
    $or: [{ images: { $exists: false } }, { images: { $size: 0 } }],
  });
  const imageMissingUrl = await countRaw({
    images: { $elemMatch: { $or: [{ url: { $exists: false } }, { url: "" }] } },
  });
  const imageNonHttpUrl = await countRaw({
    images: {
      $elemMatch: { url: { $exists: true, $not: { $regex: "^https?://" } } },
    },
  });

  // Required scalar fields that must never be null/absent.
  const missingName = await countRaw({
    $or: [{ name: { $exists: false } }, { name: "" }],
  });
  const missingSlug = await countRaw({
    $or: [{ slug: { $exists: false } }, { slug: "" }],
  });
  const missingSku = await countRaw({
    $or: [{ sku: { $exists: false } }, { sku: "" }],
  });
  const missingCategory = await countRaw({ categoryId: { $exists: false } });
  const badPrice = await countRaw({
    $or: [{ price: { $exists: false } }, { price: { $lt: 0 } }],
  });

  const rows: Array<[string, number, boolean]> = [
    ["Total products", total, false],
    ["  ACTIVE", statusActive, false],
    ["  INACTIVE", statusInactive, false],
    ["  other/invalid status", statusOther, statusOther > 0],
    ["Soft-deleted (deletedAt set)", softDeleted, false],
    ["deletedAt field ABSENT (Atlas gotcha)", deletedAtAbsent, deletedAtAbsent > 0],
    ["Products with NO images", noImages, false],
    ["Images missing a url", imageMissingUrl, imageMissingUrl > 0],
    ["Images with non-http url", imageNonHttpUrl, imageNonHttpUrl > 0],
    ["Missing/empty name", missingName, missingName > 0],
    ["Missing/empty slug", missingSlug, missingSlug > 0],
    ["Missing/empty sku", missingSku, missingSku > 0],
    ["Missing categoryId", missingCategory, missingCategory > 0],
    ["Missing/negative price", badPrice, badPrice > 0],
  ];

  let problems = 0;
  for (const [label, n, bad] of rows) {
    if (bad) problems += 1;
    const flag = bad ? "  ⚠️  PROBLEM" : "";
    console.log(`${String(n).padStart(6)}  ${label}${flag}`);
  }

  console.log(
    problems === 0
      ? "\n✅ No integrity problems detected.\n"
      : `\n⚠️  ${problems} problem categor${problems === 1 ? "y" : "ies"} found — see PROBLEM rows above.\n`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
