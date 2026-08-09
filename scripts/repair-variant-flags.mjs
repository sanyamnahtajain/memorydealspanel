/**
 * One-shot repair for products stranded by the old non-atomic variant save.
 *
 * The pre-fix `saveProductVariants` set `hasVariants: true` BEFORE validating
 * rows, so a failed save could leave a product flagged as a variant product
 * with zero (or zero ACTIVE) variant rows. The storefront renders the variant
 * hero only when `hasVariants && variants.length > 0`, so such products showed
 * no price/CTA — "my variants don't show on the website".
 *
 * This script:
 *   1. hasVariants=true with ZERO variant rows        → hasVariants=false
 *      (the product goes back to behaving as a plain product; its own
 *      price/sku/stock are still on the row and were never touched).
 *   2. hasVariants=true with rows but none ACTIVE     → reported only.
 *      (Deliberate: activating a variant is a business decision — do it in
 *      the admin editor. The report tells you exactly which products.)
 *
 * Idempotent — safe to run any number of times.
 *
 *   node scripts/repair-variant-flags.mjs           # report + fix case 1
 *   DRY_RUN=1 node scripts/repair-variant-flags.mjs # report only
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const dryRun = process.env.DRY_RUN === "1";

const flagged = await prisma.product.findMany({
  where: { hasVariants: true },
  select: { id: true, name: true, sku: true },
});

let fixed = 0;
const inactiveOnly = [];

for (const p of flagged) {
  const [total, active] = await Promise.all([
    prisma.productVariant.count({ where: { productId: p.id } }),
    prisma.productVariant.count({
      where: { productId: p.id, status: "ACTIVE" },
    }),
  ]);

  if (total === 0) {
    console.log(`orphan  ${p.sku}  "${p.name}" — hasVariants=true, 0 rows`);
    if (!dryRun) {
      await prisma.product.update({
        where: { id: p.id },
        data: { hasVariants: false },
      });
      fixed += 1;
    }
  } else if (active === 0) {
    inactiveOnly.push(`${p.sku}  "${p.name}" — ${total} rows, none ACTIVE`);
  }
}

console.log(
  `\n${flagged.length} variant products checked · ${fixed} orphan flag(s) ${
    dryRun ? "would be" : ""
  } cleared`,
);
if (inactiveOnly.length > 0) {
  console.log(
    `\n${inactiveOnly.length} product(s) have variants but none ACTIVE — activate one in the admin editor:`,
  );
  for (const line of inactiveOnly) console.log(`  ${line}`);
}

await prisma.$disconnect();
