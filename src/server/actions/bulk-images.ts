"use server";

import { z } from "zod";
import { prisma } from "@/server/db";
import { resolveViewer } from "@/server/auth/viewer";
import { assertAdmin, isForbiddenError } from "@/server/dal/guard";
import { assertPermission } from "@/server/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { writeAudit } from "@/server/security/audit";
import { MAX_IMAGES_PER_PRODUCT } from "@/lib/constants";
import { isObjectId, tokenFromFilename } from "./bulk-image-match";

/**
 * Bulk image → product matching.
 *
 * The uploader hands us the filenames it picked; we derive a leading token from
 * each (everything before the first `-`, `_`, `.`, space or paren) and match it
 * against live products. A token that is a 24-hex Mongo ObjectId matches by
 * product id; anything else matches — case-insensitively — by SKU. Id matching
 * is the reliable path now that SKUs are auto-generated: an admin can export the
 * catalog CSV (its first column is `id`) and name each photo after the id.
 *
 * The returned plan tells the client which file targets which product (with its
 * current image count so it can enforce the per-product cap) and flags anything
 * unmatched.
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
  /** The token parsed from the filename (a product id or SKU). */
  token: string;
  /** Whether the token matched a product id or a SKU. */
  matchedBy: "id" | "sku";
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
  /** The parsed token, or null when the filename had no usable one. */
  token: string | null;
  reason: "no-token" | "unknown";
}

export interface MatchPlan {
  matched: MatchedImage[];
  unmatched: UnmatchedImage[];
  /** Total files considered. */
  total: number;
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

    // Parse tokens up front and classify each as a product id (24-hex) or a
    // SKU. Collect the distinct sets for one DB round-trip.
    const parsed = input.map((file) => {
      const token = tokenFromFilename(file.filename);
      return {
        filename: file.filename,
        token,
        isId: token !== null && isObjectId(token),
      };
    });
    const ids = Array.from(
      new Set(parsed.filter((p) => p.isId && p.token).map((p) => p.token!)),
    );
    const skus = Array.from(
      new Set(
        parsed
          .filter((p) => !p.isId && p.token)
          .map((p) => p.token!),
      ),
    );

    // One read for both match paths: products whose id OR SKU is in our sets.
    const or: import("@prisma/client").Prisma.ProductWhereInput[] = [];
    if (ids.length) or.push({ id: { in: ids } });
    if (skus.length) or.push({ sku: { in: skus, mode: "insensitive" } });
    const products = or.length
      ? await prisma.product.findMany({
          where: { deletedAt: null, OR: or },
          select: { id: true, name: true, sku: true, images: true },
        })
      : [];
    const byId = new Map(products.map((product) => [product.id, product]));
    const bySku = new Map(
      products.map((product) => [product.sku.toLowerCase(), product]),
    );

    const matched: MatchedImage[] = [];
    const unmatched: UnmatchedImage[] = [];

    for (const { filename, token, isId } of parsed) {
      if (token === null) {
        unmatched.push({ filename, token: null, reason: "no-token" });
        continue;
      }
      const product = isId ? byId.get(token) : bySku.get(token.toLowerCase());
      if (!product) {
        unmatched.push({ filename, token, reason: "unknown" });
        continue;
      }
      const currentImageCount = product.images.length;
      matched.push({
        filename,
        token,
        matchedBy: isId ? "id" : "sku",
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
