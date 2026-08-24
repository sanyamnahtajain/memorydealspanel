/**
 * Remove duplicate DeviceModel rows that block the unique index.
 *
 * WHY THEY EXIST: the device-model import ran twice. Slugification strips the
 * "+" from a name, so "Galaxy S21" and "Galaxy S21+" collide and the second
 * copy lands as "galaxy-s21-2", "-3" and so on. Every duplicate found is a
 * "+" model, all created the same day. The NAME is unique in the schema, so
 * `prisma db push` cannot build `DeviceModel_name_key` and the entire push
 * aborts — taking every other index with it.
 *
 * SAFETY. A device model is referenced by id from FOUR places, none of them a
 * foreign key Mongo would protect — they are all ids inside JSON:
 *
 *   1. Order.items[].breakdown[].modelId   — frozen order history
 *   2. CartItem.breakdown[].modelId        — live customer carts
 *   3. Product.allocation.modelIds[]       — which models a product allows
 *   4. Category.defaultAllocation.modelIds[] — the category-level default
 *
 * This script counts all four before touching anything, and REFUSES to delete
 * a row with any reference. Deleting a referenced model would silently break
 * a live cart or orphan a frozen order line — invisible until a customer hits
 * it. When both copies in a group are referenced it skips the group entirely
 * and tells you to rename one by hand instead.
 *
 * DRY RUN BY DEFAULT — it prints what it would do and changes nothing:
 *
 *   DATABASE_URL="mongodb+srv://..." node scripts/dedupe-device-models.mjs
 *
 * Then, once the plan looks right:
 *
 *   DATABASE_URL="mongodb+srv://..." node scripts/dedupe-device-models.mjs --apply
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/** Normalised grouping key — the same comparison the unique index makes. */
function nameKey(model) {
  return (model.name ?? "").trim().toLowerCase();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/** Count every reference to each candidate id, across all four sites. */
async function countReferences(ids) {
  const counts = new Map(ids.map((id) => [id, { orders: 0, carts: 0, products: 0, categories: 0 }]));
  const bump = (id, field) => {
    const entry = counts.get(id);
    if (entry) entry[field] += 1;
  };

  const orders = await prisma.order.findMany({ select: { items: true } });
  for (const order of orders) {
    for (const item of asArray(order.items)) {
      for (const part of asArray(item?.breakdown)) {
        if (typeof part?.modelId === "string") bump(part.modelId, "orders");
      }
    }
  }

  const cartItems = await prisma.cartItem.findMany({ select: { breakdown: true } });
  for (const line of cartItems) {
    for (const part of asArray(line.breakdown)) {
      if (typeof part?.modelId === "string") bump(part.modelId, "carts");
    }
  }

  const products = await prisma.product.findMany({ select: { allocation: true } });
  for (const product of products) {
    for (const id of asArray(product.allocation?.modelIds)) {
      if (typeof id === "string") bump(id, "products");
    }
  }

  const categories = await prisma.category.findMany({
    select: { defaultAllocation: true },
  });
  for (const category of categories) {
    for (const id of asArray(category.defaultAllocation?.modelIds)) {
      if (typeof id === "string") bump(id, "categories");
    }
  }

  return counts;
}

function total(ref) {
  return ref.orders + ref.carts + ref.products + ref.categories;
}

function describe(ref) {
  return `orders=${ref.orders} carts=${ref.carts} products=${ref.products} categories=${ref.categories}`;
}

async function main() {
  // Show the host only — never the credentials in the connection string.
  const raw = process.env.DATABASE_URL ?? "";
  const host =
    raw.replace(/^mongodb(\+srv)?:\/\//, "").split("@").pop()?.split("/")[0] ??
    "(unknown)";
  console.log(`[dedupe] database host: ${host}`);
  console.log(
    APPLY
      ? "[dedupe] MODE: APPLY — rows will be deleted.\n"
      : "[dedupe] MODE: dry run — nothing will change. Add --apply to execute.\n",
  );

  const models = await prisma.deviceModel.findMany({
    select: { id: true, name: true, slug: true, brandName: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const groups = new Map();
  for (const model of models) {
    const key = nameKey(model);
    if (!key) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(model);
    else groups.set(key, [model]);
  }
  const duplicates = [...groups.entries()].filter(([, rows]) => rows.length > 1);

  if (duplicates.length === 0) {
    console.log("[dedupe] no duplicate names — `prisma db push` should succeed.");
    return;
  }
  console.log(`[dedupe] ${duplicates.length} duplicate name group(s).`);

  const candidateIds = duplicates.flatMap(([, rows]) => rows.map((r) => r.id));
  const refs = await countReferences(candidateIds);

  const toDelete = [];
  const needsHuman = [];

  for (const [key, rows] of duplicates) {
    const used = rows.filter((r) => total(refs.get(r.id)) > 0);

    if (used.length > 1) {
      // Both copies are live somewhere — deleting either loses data.
      needsHuman.push({ key, rows });
      continue;
    }

    // Keep the referenced row; with none referenced, keep the oldest (the
    // original import) so the surviving slug is the cleaner one.
    const keep = used[0] ?? rows[0];
    for (const row of rows) {
      if (row.id !== keep.id && total(refs.get(row.id)) === 0) {
        toDelete.push({ row, keep, key });
      }
    }
  }

  console.log("");
  for (const { row, keep, key } of toDelete) {
    console.log(
      `  "${key}"\n    keep   ${keep.id}  slug=${keep.slug}\n` +
        `    delete ${row.id}  slug=${row.slug}  (${describe(refs.get(row.id))})`,
    );
  }

  if (needsHuman.length > 0) {
    console.log(
      `\n[dedupe] ${needsHuman.length} group(s) need a human — both copies are in use:`,
    );
    for (const { key, rows } of needsHuman) {
      console.log(`  "${key}"`);
      for (const row of rows) {
        console.log(`    ${row.id}  slug=${row.slug}  (${describe(refs.get(row.id))})`);
      }
    }
    console.log(
      "  → RENAME one of each pair in the admin panel (e.g. add the storage " +
        "size). Do not delete: both are referenced by live data.",
    );
  }

  console.log(`\n[dedupe] would delete ${toDelete.length} row(s).`);

  if (!APPLY) {
    console.log("[dedupe] dry run — nothing changed. Re-run with --apply to do it.");
    return;
  }

  let deleted = 0;
  for (const { row } of toDelete) {
    try {
      await prisma.deviceModel.delete({ where: { id: row.id } });
      deleted += 1;
    } catch (error) {
      console.error(`[dedupe] failed to delete ${row.id}: ${error.message}`);
    }
  }
  console.log(`[dedupe] deleted ${deleted} row(s).`);
  console.log(
    needsHuman.length > 0
      ? "[dedupe] resolve the groups above by hand, then re-run `prisma db push`."
      : "[dedupe] now re-run `prisma db push`.",
  );
}

main()
  .catch((error) => {
    console.error("[dedupe] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
