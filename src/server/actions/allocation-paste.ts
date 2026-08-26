"use server";

import { prisma } from "@/server/db";
import { resolveViewer } from "@/server/auth/viewer";
import { isAdmin, isCustomer } from "@/server/types/viewer";
import { limit } from "@/server/security/ratelimit";
import { resolveEffectiveAllocation } from "@/lib/allocation";
import {
  matchBreakdownPasteSchema,
  matchPasteText,
  type PasteMatchRow,
} from "@/lib/allocation-paste";

/**
 * Paste-a-list resolution for the allocation builder: the buyer pastes
 * "S23 Ultra 20" lines, this action matches the names against the ACTIVE
 * DeviceModel master (scoped to the product's allocation restriction — a
 * restricted product can never resolve a model outside its allow-list) and
 * returns filled rows plus the lines it could not read. A readable line that
 * matches NO candidate comes back as a CUSTOM (typed) row — free-text models
 * are allowed even on restricted products, because the restriction list (like
 * the master list itself) is never complete.
 *
 * Same trust level as `searchDeviceModelsAction`: model names are non-monetary
 * catalog metadata, so any signed-in customer or admin may call it; it is
 * rate-limited per principal. All matching logic is pure and lives in
 * src/lib/allocation-paste.ts.
 */

export type MatchBreakdownPasteResult =
  | {
      ok: true;
      rows: PasteMatchRow[];
      /** Typed names that matched no master model — returned as custom rows. */
      addedAsTyped: string[];
      unreadable: string[];
      overflow: number;
    }
  | { ok: false; message: string };

export async function matchBreakdownPasteAction(
  input: unknown,
): Promise<MatchBreakdownPasteResult> {
  const viewer = await resolveViewer();
  if (!isCustomer(viewer) && !isAdmin(viewer)) {
    return { ok: false, message: "Please sign in first." };
  }

  const parsed = matchBreakdownPasteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Paste your list first — one model per line." };
  }

  const principal = isCustomer(viewer) ? viewer.customerId : viewer.adminId;
  const rl = await limit(
    principal,
    { points: 15, window: 60 },
    "allocation-paste",
  );
  if (!rl.ok) {
    return { ok: false, message: "Too many tries — wait a moment." };
  }

  try {
    const product = await prisma.product.findUnique({
      where: { id: parsed.data.productId },
      select: {
        allocation: true,
        category: { select: { defaultAllocation: true } },
      },
    });
    if (!product) {
      return { ok: false, message: "This product is not available." };
    }

    const allocation = resolveEffectiveAllocation(
      product.allocation,
      product.category?.defaultAllocation,
    );
    const candidates = await prisma.deviceModel.findMany({
      where: {
        status: "ACTIVE",
        ...(allocation && allocation.modelIds.length > 0
          ? { id: { in: allocation.modelIds } }
          : {}),
      },
      select: { id: true, name: true },
      take: 3000,
    });

    const result = matchPasteText(parsed.data.text, candidates);
    return { ok: true, ...result };
  } catch (error) {
    console.error("[actions/allocation-paste] match failed:", error);
    return { ok: false, message: "Could not read your list. Please try again." };
  }
}
