"use server";

import { z } from "zod";
import { prisma } from "@/server/db";
import { resolveViewer } from "@/server/auth/viewer";
import { assertAdmin, isForbiddenError } from "@/server/dal/guard";
import { assertPermission } from "@/server/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { writeAudit } from "@/server/security/audit";
import { MAX_IMAGES_PER_PRODUCT } from "@/lib/constants";

/**
 * Bulk image → product matching.
 *
 * The uploader hands us the filenames it picked; we derive a SKU from each
 * (the leading token before the first `-`, `_`, `.` or space) and match it —
 * case-insensitively — against live products. The returned plan tells the
 * client which file targets which product (with its current image count so it
 * can enforce the per-product cap) and flags anything unmatched.
 *
 * The actual compress → presign → PUT → attach happens client-side (it reuses
 * the existing `presignUpload` / `attachImageToProduct` pipeline), so this
 * action is purely the read-side planner plus an audit record of the run.
 */

// ---------------------------------------------------------------------------
// Result envelope
// ---------------------------------------------------------------------------

export type BulkImageActionResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

function fail(error: string): BulkImageActionResult<never> {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const fileMetaSchema = z.object({
  filename: z.string().trim().min(1, "filename is required").max(255),
});

const matchInputSchema = z
  .array(fileMetaSchema)
  .min(1, "Select at least one image.")
  .max(500, "Too many files in one batch (max 500).");

export type BulkImageFileMeta = z.infer<typeof fileMetaSchema>;

// ---------------------------------------------------------------------------
// Match plan shape
// ---------------------------------------------------------------------------

/** One matched file → product pairing. */
export interface MatchedImage {
  filename: string;
  /** The SKU token parsed from the filename. */
  sku: string;
  productId: string;
  productName: string;
  productSku: string;
  /** How many images the product already has (for cap enforcement). */
  currentImageCount: number;
  /** True when the product is already at the per-product image cap. */
  atCapacity: boolean;
}

/** One file that could not be matched to a product. */
export interface UnmatchedImage {
  filename: string;
  /** The parsed SKU, or null when the filename had no usable token. */
  sku: string | null;
  reason: "no-sku" | "unknown-sku";
}

export interface MatchPlan {
  matched: MatchedImage[];
  unmatched: UnmatchedImage[];
  /** Total files considered. */
  total: number;
}

// ---------------------------------------------------------------------------
// SKU parsing
// ---------------------------------------------------------------------------

/**
 * Derive the SKU token from a filename such as `SKU123-1.jpg`, `sku123_2.png`
 * or `SKU123 (front).webp`. We take everything up to the first separator
 * (`-`, `_`, `.`, space or paren) after stripping any directory prefix.
 * Returns null when nothing usable remains.
 */
export function skuFromFilename(filename: string): string | null {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const token = base.split(/[-_.\s(]/)[0]?.trim();
  return token && token.length > 0 ? token : null;
}

// ---------------------------------------------------------------------------
// matchImagesToSkus
// ---------------------------------------------------------------------------

/**
 * Build a match plan for a batch of picked files. Admin-only. Records an audit
 * entry summarising how many files matched so the run is traceable, even
 * though the uploads themselves are attached individually client-side.
 */
export async function matchImagesToSkus(
  files: BulkImageFileMeta[],
): Promise<BulkImageActionResult<{ plan: MatchPlan }>> {
  try {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.PRODUCTS_EDIT);
    const input = matchInputSchema.parse(files);

    // Parse SKUs up front; collect the distinct set for one DB round-trip.
    const parsed = input.map((file) => ({
      filename: file.filename,
      sku: skuFromFilename(file.filename),
    }));
    const skus = Array.from(
      new Set(
        parsed
          .map((p) => p.sku)
          .filter((sku): sku is string => sku !== null),
      ),
    );

    // Case-insensitive lookup: index live products by lower-cased SKU.
    const products = skus.length
      ? await prisma.product.findMany({
          where: {
            deletedAt: null,
            sku: { in: skus, mode: "insensitive" },
          },
          select: { id: true, name: true, sku: true, images: true },
        })
      : [];
    const bySku = new Map(
      products.map((product) => [product.sku.toLowerCase(), product]),
    );

    const matched: MatchedImage[] = [];
    const unmatched: UnmatchedImage[] = [];

    for (const { filename, sku } of parsed) {
      if (sku === null) {
        unmatched.push({ filename, sku: null, reason: "no-sku" });
        continue;
      }
      const product = bySku.get(sku.toLowerCase());
      if (!product) {
        unmatched.push({ filename, sku, reason: "unknown-sku" });
        continue;
      }
      const currentImageCount = product.images.length;
      matched.push({
        filename,
        sku,
        productId: product.id,
        productName: product.name,
        productSku: product.sku,
        currentImageCount,
        atCapacity: currentImageCount >= MAX_IMAGES_PER_PRODUCT,
      });
    }

    await writeAudit({
      actorType: "admin",
      actorId: viewer.adminId,
      action: "product.image.bulkMatch",
      entity: "Product",
      entityId: "*",
      diff: {
        total: parsed.length,
        matched: matched.length,
        unmatched: unmatched.length,
      },
    });

    return {
      ok: true,
      plan: { matched, unmatched, total: parsed.length },
    };
  } catch (error) {
    if (isForbiddenError(error)) {
      return fail("You do not have permission to bulk-upload images.");
    }
    if (error instanceof z.ZodError) {
      return fail(error.issues[0]?.message ?? "Invalid file list.");
    }
    console.error("[bulk-images] matchImagesToSkus failed:", error);
    return fail("Could not match the images. Please try again.");
  }
}
