"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { PERMISSIONS } from "@/lib/permissions";
import {
  billingGroupInputSchema,
  type BillingGroupActionResult,
  type BillingGroupImpactResult,
  type BillingGroupSimpleResult,
} from "@/lib/schemas/billing-group";
import { objectIdSchema } from "@/lib/schemas/shared";
import { resolveViewer } from "@/server/auth/viewer";
import { assertAdmin, isForbiddenError } from "@/server/dal/guard";
import { assertPermission } from "@/server/auth/require-permission";
import { writeAudit } from "@/server/security/audit";
import {
  BillingGroupCodeTakenError,
  BillingGroupNotFoundError,
  countLiveCartsForBrands,
  createBillingGroup,
  deleteBillingGroup,
  setBillingGroupActive,
  updateBillingGroup,
} from "@/server/services/billing-groups";

/**
 * Billing-group server actions — thin transport wrappers over the service.
 *
 * Pipeline (the tax-settings convention):
 *   assertAdmin → assertPermission(settings.manage) → zod → service →
 *   audit → revalidate. Never throws across the client boundary.
 *
 * Revalidation also touches the storefront cart because the live cart
 * preview re-buckets on every render under the CURRENT rules.
 */

const BILLING_GROUPS_PATH = "/admin/settings/billing-groups";
const CART_PATH = "/account/cart";

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input.";
}

function revalidate() {
  revalidatePath(BILLING_GROUPS_PATH);
  revalidatePath(CART_PATH);
}

function mapError(error: unknown, fallback: string): { ok: false; error: string } {
  if (isForbiddenError(error)) {
    return { ok: false, error: "You don't have permission to manage billing groups." };
  }
  if (
    error instanceof BillingGroupCodeTakenError ||
    error instanceof BillingGroupNotFoundError
  ) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

const saveSchema = billingGroupInputSchema.extend({
  id: objectIdSchema.optional(),
});

/** Create (no `id`) or update (with `id`) a billing group. */
export async function saveBillingGroupAction(
  input: unknown,
): Promise<BillingGroupActionResult> {
  try {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.SETTINGS_MANAGE);

    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: firstIssue(parsed.error) };
    }
    const { id, ...data } = parsed.data;

    const record = id
      ? await updateBillingGroup(id, data)
      : await createBillingGroup(data);

    await writeAudit({
      actorType: "admin",
      actorId: viewer.adminId,
      action: id ? "billing_group.update" : "billing_group.create",
      entity: "BillingGroup",
      entityId: record.id,
      diff: {
        name: record.name,
        code: record.code,
        active: record.active,
        brandCount: record.matcher.brandIds.length,
        tierCount: record.rules.reduce((n, r) => n + r.tiers.length, 0),
        separateBill: record.separateBill,
        couponStacking: record.couponStacking,
      },
    });

    revalidate();
    return { ok: true, id: record.id };
  } catch (error) {
    return mapError(error, "Could not save the billing group.");
  }
}

const setActiveSchema = z.object({ id: objectIdSchema, active: z.boolean() });

/** The per-group kill switch. */
export async function setBillingGroupActiveAction(
  input: unknown,
): Promise<BillingGroupSimpleResult> {
  try {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.SETTINGS_MANAGE);

    const parsed = setActiveSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: firstIssue(parsed.error) };
    }

    const record = await setBillingGroupActive(parsed.data.id, parsed.data.active);

    await writeAudit({
      actorType: "admin",
      actorId: viewer.adminId,
      action: "billing_group.setStatus",
      entity: "BillingGroup",
      entityId: record.id,
      diff: { active: parsed.data.active },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return mapError(error, "Could not update the billing group.");
  }
}

const deleteSchema = z.object({ id: objectIdSchema });

/** Delete a group. Placed orders keep their frozen snapshot; carts re-bucket. */
export async function deleteBillingGroupAction(
  input: unknown,
): Promise<BillingGroupSimpleResult> {
  try {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.SETTINGS_MANAGE);

    const parsed = deleteSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: firstIssue(parsed.error) };
    }

    await deleteBillingGroup(parsed.data.id);

    await writeAudit({
      actorType: "admin",
      actorId: viewer.adminId,
      action: "billing_group.delete",
      entity: "BillingGroup",
      entityId: parsed.data.id,
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return mapError(error, "Could not delete the billing group.");
  }
}

const impactSchema = z.object({ brandIds: z.array(objectIdSchema).max(200) });

/** How many customers currently have these brands in their cart (read-only). */
export async function previewBillingGroupImpactAction(
  input: unknown,
): Promise<BillingGroupImpactResult> {
  try {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.SETTINGS_MANAGE);

    const parsed = impactSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: firstIssue(parsed.error) };
    }

    const liveCarts = await countLiveCartsForBrands(parsed.data.brandIds);
    return { ok: true, liveCarts };
  } catch (error) {
    return mapError(error, "Could not load cart impact.");
  }
}
