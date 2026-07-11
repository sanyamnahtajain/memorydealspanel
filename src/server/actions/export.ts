import * as XLSX from "xlsx";
import { prisma } from "@/server/db";
import { formatPaise } from "@/lib/money";

/**
 * Catalog export assembly.
 *
 * `buildCatalogWorkbook` reads the FULL admin catalog (every product,
 * including inactive ones; soft-deleted rows are excluded) and produces a
 * SheetJS workbook with one row per product. It is the pure data half of the
 * export feature — authorization and HTTP streaming live in the route handler
 * (`src/app/api/export/route.ts`), which is the only caller.
 *
 * Money columns follow the house rule (integer paise at rest): each product
 * gets a human `price`/`mrp` column formatted as rupees AND a raw
 * `price_paise`/`mrp_paise` integer column so the export round-trips losslessly.
 */

/** Column order for the exported sheet — also used as the header row. */
const HEADERS = [
  "id",
  "sku",
  "name",
  "slug",
  "brand",
  "category",
  "categoryId",
  "description",
  "price",
  "price_paise",
  "mrp",
  "mrp_paise",
  "marginPct",
  "moq",
  "stockStatus",
  "status",
  "tags",
  "hsn_code",
  "gst_rate",
  "tax_inclusive",
  "imageCount",
  "primaryImageUrl",
  "createdAt",
  "updatedAt",
] as const;

type Header = (typeof HEADERS)[number];
type CatalogRow = Record<Header, string | number | null>;

/** Whole-number discount percentage of `price` vs `mrp`, when mrp is higher. */
function marginPct(price: number, mrp: number | null): number | null {
  if (mrp === null || mrp <= 0 || mrp <= price) {
    return null;
  }
  return Math.round(((mrp - price) / mrp) * 100);
}

/** ISO-8601 string for a date, or empty when absent. */
function iso(date: Date | null | undefined): string {
  return date ? date.toISOString() : "";
}

/**
 * Load every live product joined to its category name and flatten it into an
 * export row. Category lookups are resolved in one pass to avoid N+1 queries.
 */
async function loadCatalogRows(): Promise<CatalogRow[]> {
  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      where: { deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        sku: true,
        name: true,
        slug: true,
        brand: true,
        categoryId: true,
        description: true,
        price: true,
        mrp: true,
        moq: true,
        stockStatus: true,
        status: true,
        tags: true,
        hsnCode: true,
        gstRateBps: true,
        taxTreatment: true,
        images: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.category.findMany({ select: { id: true, name: true } }),
  ]);

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  return products.map((product) => {
    const primary =
      product.images.find((img) => img.isPrimary) ?? product.images[0] ?? null;
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      slug: product.slug,
      brand: product.brand ?? "",
      category: categoryName.get(product.categoryId) ?? "",
      categoryId: product.categoryId,
      description: product.description ?? "",
      price: formatPaise(product.price),
      price_paise: product.price,
      mrp: product.mrp === null ? "" : formatPaise(product.mrp),
      mrp_paise: product.mrp ?? "",
      marginPct: marginPct(product.price, product.mrp ?? null),
      moq: product.moq ?? "",
      stockStatus: product.stockStatus,
      status: product.status,
      tags: product.tags.join(", "),
      // GST override columns — raw stored values, so an export→edit→import round
      // trips losslessly. Empty when the product inherits (no own override).
      hsn_code: product.hsnCode ?? "",
      gst_rate: product.gstRateBps == null ? "" : product.gstRateBps / 100,
      tax_inclusive:
        product.taxTreatment == null
          ? ""
          : product.taxTreatment === "TAX_INCLUSIVE"
            ? "true"
            : "false",
      imageCount: product.images.length,
      primaryImageUrl: primary?.url ?? "",
      createdAt: iso(product.createdAt),
      updatedAt: iso(product.updatedAt),
    };
  });
}

/** A built catalog workbook plus the row count it contains. */
export interface CatalogWorkbook {
  workbook: XLSX.WorkBook;
  rowCount: number;
}

/**
 * Assemble the catalog workbook. The single "Catalog" worksheet has a fixed
 * header row (see {@link HEADERS}) followed by one row per live product.
 */
export async function buildCatalogWorkbook(): Promise<CatalogWorkbook> {
  const rows = await loadCatalogRows();
  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: HEADERS as unknown as string[],
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Catalog");
  return { workbook, rowCount: rows.length };
}

/** Serialize a workbook to an `.xlsx` byte buffer. */
export function workbookToXlsx(workbook: XLSX.WorkBook): Buffer {
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Serialize the first worksheet of a workbook to a CSV string. */
export function workbookToCsv(workbook: XLSX.WorkBook): string {
  const first = workbook.SheetNames[0];
  const sheet = workbook.Sheets[first];
  return XLSX.utils.sheet_to_csv(sheet);
}
