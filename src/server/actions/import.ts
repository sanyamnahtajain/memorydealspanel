"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/server/db";
import { resolveViewer } from "@/server/auth/viewer";
import { assertAdmin, isForbiddenError } from "@/server/dal/guard";
import { assertPermission } from "@/server/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { writeAudit } from "@/server/security/audit";
import {
  parseWorkbook,
  autoMapColumns,
  validateRows,
  commitImport,
  buildTemplateWorkbook,
  IMPORT_COLUMNS,
  type ColumnMapping,
  type PreviewRow,
  type CategoryRef,
  type ImportField,
} from "@/server/services/import";

/**
 * Import server actions (PRD F-A19).
 *
 * Every action is admin-gated. `uploadAndParse` and `previewImport` are pure
 * read/compute helpers (they never mutate), but still require an admin session
 * because they expose catalog SKUs and category names. `commitImport` mutates
 * through the audited product service layer and writes its own summary audit.
 *
 * Nothing throws to the client: failures return a typed `{ ok:false, error }`.
 */

export type ActionResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const ACTOR = "admin" as const;

async function guarded<T>(
  run: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (error) {
    if (isForbiddenError(error)) {
      return { ok: false, error: "You are not authorised to do that." };
    }
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues[0]?.message ?? "Invalid input." };
    }
    console.error("[actions/import] unexpected error:", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** Loads the catalog context needed to validate an import (skus + categories). */
async function loadImportContext(): Promise<{
  existingSkus: string[];
  categories: CategoryRef[];
}> {
  const [skuRows, categoryRows] = await Promise.all([
    prisma.product.findMany({
      where: { deletedAt: null },
      select: { sku: true },
    }),
    prisma.category.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);
  return {
    existingSkus: skuRows.map((r) => r.sku),
    categories: categoryRows.map((r) => ({ id: r.id, name: r.name })),
  };
}

/* ------------------------------------------------------------------ */
/* uploadAndParse                                                      */
/* ------------------------------------------------------------------ */

export interface ParsedUpload {
  headers: string[];
  rows: Record<string, string>[];
  droppedBlank: number;
  suggestedMapping: ColumnMapping;
  categories: CategoryRef[];
  /** SKUs already in the catalog (lowercased) so the client can classify. */
  existingSkus: string[];
  /** The canonical field metadata for the mapper UI. */
  fields: Array<{ key: ImportField; label: string; required: boolean }>;
}

/**
 * Parses an uploaded CSV/XLSX (base64) into headers + rows, auto-suggests a
 * column mapping, and returns the catalog context the wizard needs to preview
 * and validate entirely on the client. Read-only; admin-gated.
 */
export async function uploadAndParse(
  fileBase64: string,
): Promise<ActionResult<ParsedUpload>> {
  return guarded<ParsedUpload>(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.IMPORT_RUN);

    const base64 = z.string().min(1, "No file provided.").parse(fileBase64);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(Buffer.from(base64, "base64"));
    } catch {
      return { ok: false, error: "Could not read the uploaded file." };
    }
    if (bytes.byteLength === 0) {
      return { ok: false, error: "The uploaded file is empty." };
    }

    const parsed = parseWorkbook(bytes);
    if (parsed.headers.length === 0) {
      return {
        ok: false,
        error: "No columns found. Is the first row a header?",
      };
    }
    if (parsed.rows.length === 0) {
      return { ok: false, error: "No data rows found in the file." };
    }

    const { existingSkus, categories } = await loadImportContext();

    return {
      ok: true,
      headers: parsed.headers,
      rows: parsed.rows,
      droppedBlank: parsed.droppedBlank,
      suggestedMapping: autoMapColumns(parsed.headers),
      categories,
      existingSkus: existingSkus.map((s) => s.toLowerCase()),
      fields: IMPORT_COLUMNS.map((c) => ({
        key: c.key,
        label: c.label,
        required: c.required,
      })),
    };
  });
}

/* ------------------------------------------------------------------ */
/* previewImport — server-side re-validation (source of truth)         */
/* ------------------------------------------------------------------ */

const previewInputSchema = z.object({
  rows: z.array(z.record(z.string(), z.string())),
  mapping: z.record(z.string(), z.string()),
  /**
   * Original sheet headers (in order). Required to INFER variant option axes
   * (any header not claimed by a canonical field becomes an option column).
   * Optional for backward-compatible plain imports that never map `variantOf`.
   */
  headers: z.array(z.string()).optional(),
});

export interface PreviewResult {
  rows: PreviewRow[];
  summary: {
    total: number;
    creates: number;
    updates: number;
    invalid: number;
    /** Variant PRODUCTS (parent groups) detected. */
    variantProducts: number;
    /** Variant ROWS across all groups. */
    variantRows: number;
  };
}

/**
 * Re-validates the raw rows against the LIVE catalog (fresh SKUs + categories)
 * with the chosen mapping. This is the authoritative validation the client
 * trusts for the preview grid, and it is re-run at commit time so a stale
 * client preview can never write bad data.
 */
export async function previewImport(
  input: z.input<typeof previewInputSchema>,
): Promise<ActionResult<PreviewResult>> {
  return guarded(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.IMPORT_RUN);

    const { rows, mapping, headers } = previewInputSchema.parse(input);
    const { existingSkus, categories } = await loadImportContext();

    const result = validateRows(
      rows,
      mapping as ColumnMapping,
      existingSkus,
      categories,
      headers,
    );
    return { ok: true, rows: result.rows, summary: result.summary };
  });
}

/* ------------------------------------------------------------------ */
/* commitImportAction                                                  */
/* ------------------------------------------------------------------ */

const commitInputSchema = z.object({
  rows: z.array(z.record(z.string(), z.string())),
  mapping: z.record(z.string(), z.string()),
  /** Original sheet headers — needed to infer variant option axes (see above). */
  headers: z.array(z.string()).optional(),
});

export interface CommitSummary {
  created: number;
  updated: number;
  skipped: Array<{ rowNumber: number; sku: string; reason: string }>;
  /** base64 of a UTF-8 CSV of every skipped/failed row (empty ⇒ none). */
  errorsCsvBase64: string;
  /** Variant PRODUCTS created (a new `variantOf` parent group). */
  variantProductsCreated: number;
  /** Variant PRODUCTS updated (parent already existed). */
  variantProductsUpdated: number;
  /** Total variant ROWS written across every committed group. */
  variantsWritten: number;
  /** Brand masters auto-created during this run (empty ⇒ none). */
  newBrands: string[];
}

/**
 * Commits an import. Re-parses the mapping and RE-VALIDATES against the live
 * catalog server-side (never trusting the client's preview), then writes each
 * valid row through the audited product services. Writes a single summary
 * audit entry and revalidates the product views.
 */
export async function commitImportAction(
  input: z.input<typeof commitInputSchema>,
): Promise<ActionResult<CommitSummary>> {
  return guarded(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.IMPORT_RUN);

    const { rows, mapping, headers } = commitInputSchema.parse(input);
    const { existingSkus, categories } = await loadImportContext();

    // Re-validate server-side WITH headers so variant grouping is re-derived
    // from the live catalog — never trusting a stale client preview.
    const validated = validateRows(
      rows,
      mapping as ColumnMapping,
      existingSkus,
      categories,
      headers,
    );

    const result = await commitImport({
      rows: validated.rows,
      variantGroups: validated.variantGroups,
    });

    const variantProductsWritten =
      result.variantProductsCreated + result.variantProductsUpdated;

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "product.import",
      entity: "Product",
      entityId: "bulk",
      diff: {
        created: result.created,
        updated: result.updated,
        skipped: result.skipped.length,
        total: validated.summary.total,
        variantProductsCreated: result.variantProductsCreated,
        variantProductsUpdated: result.variantProductsUpdated,
        variantsWritten: result.variantsWritten,
        newBrands: result.newBrands,
      },
    });

    if (
      result.created > 0 ||
      result.updated > 0 ||
      variantProductsWritten > 0
    ) {
      revalidatePath("/admin/products");
      revalidatePath("/", "layout");
    }

    return {
      ok: true,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errorsCsvBase64: result.errorsCsv
        ? Buffer.from(result.errorsCsv, "utf-8").toString("base64")
        : "",
      variantProductsCreated: result.variantProductsCreated,
      variantProductsUpdated: result.variantProductsUpdated,
      variantsWritten: result.variantsWritten,
      newBrands: result.newBrands,
    };
  });
}

/* ------------------------------------------------------------------ */
/* downloadTemplate                                                    */
/* ------------------------------------------------------------------ */

export interface TemplateFile {
  filename: string;
  /** base64 of the XLSX workbook. */
  base64: string;
}

/**
 * Returns the canonical import template as a base64 XLSX workbook, so the
 * client can trigger a download. Admin-gated.
 */
export async function downloadTemplate(): Promise<ActionResult<TemplateFile>> {
  return guarded(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.IMPORT_RUN);

    const bytes = buildTemplateWorkbook();
    return {
      ok: true,
      filename: "memorydeals-import-template.xlsx",
      base64: Buffer.from(bytes).toString("base64"),
    };
  });
}
