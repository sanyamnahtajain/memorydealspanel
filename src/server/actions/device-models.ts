"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  bulkCreateDeviceModelsSchema,
  createDeviceModelSchema,
  deleteDeviceModelActionSchema,
  searchDeviceModelsSchema,
  setDeviceModelStatusActionSchema,
  updateDeviceModelActionSchema,
} from "@/lib/schemas/device-model";
import { resolveViewer } from "@/server/auth/viewer";
import { isAdmin, isCustomer } from "@/server/types/viewer";
import { can } from "@/server/auth/require-permission";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import { writeAudit } from "@/server/security/audit";
import { limit } from "@/server/security/ratelimit";
import { parseAllocation } from "@/lib/allocation";
import { prisma } from "@/server/db";
import {
  bulkCreateDeviceModels,
  createDeviceModel,
  deleteDeviceModel,
  DeviceModelInUseError,
  DuplicateDeviceModelError,
  searchDeviceModels,
  setDeviceModelStatus,
  updateDeviceModel,
  type BulkCreateReport,
  type DeviceModelOption,
  type DeviceModelRowData,
} from "@/server/services/device-models";

/**
 * "use server" actions for the DeviceModel master (the brands.ts contract:
 * requireAdmin(permission) → zod → service → audit → revalidate, with a
 * data-envelope ActionResult).
 *
 * `searchDeviceModelsAction` is the ONE customer-reachable action: the
 * storefront allocation builder searches models by name. Model names are
 * non-monetary catalog metadata (like brand names), so it requires only a
 * signed-in customer — never prices, never other customers' data — and is
 * rate-limited.
 */

const MODELS_PATH = "/admin/models";

export type ActionResult<T = void> = [T] extends [void]
  ? { ok: true } | { ok: false; error: string }
  : { ok: true; data: T } | { ok: false; error: string };

async function requireAdmin(
  permission: Permission,
): Promise<{ ok: true; adminId: string } | { ok: false; error: string }> {
  const viewer = await resolveViewer();
  if (!isAdmin(viewer)) {
    return { ok: false, error: "You must be signed in as an admin." };
  }
  if (!(await can(viewer, permission))) {
    return { ok: false, error: "You are not authorised to do that." };
  }
  return { ok: true, adminId: viewer.adminId };
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input.";
}

/* ------------------------------------------------------------------ */
/* Admin CRUD                                                          */
/* ------------------------------------------------------------------ */

export async function createDeviceModelAction(
  input: unknown,
): Promise<ActionResult<DeviceModelRowData>> {
  const gate = await requireAdmin(PERMISSIONS.DEVICE_MODELS_MANAGE);
  if (!gate.ok) return gate;

  const parsed = createDeviceModelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  try {
    const model = await createDeviceModel(parsed.data);
    await writeAudit({
      actorType: "admin",
      actorId: gate.adminId,
      action: "device_model.create",
      entity: "DeviceModel",
      entityId: model.id,
      diff: { name: model.name, brandName: model.brandName },
    });
    revalidatePath(MODELS_PATH);
    return { ok: true, data: model };
  } catch (error) {
    if (error instanceof DuplicateDeviceModelError) {
      return { ok: false, error: error.message };
    }
    console.error("[actions/device-models] create failed:", error);
    return { ok: false, error: "Could not create the model. Please retry." };
  }
}

export async function updateDeviceModelAction(
  input: unknown,
): Promise<ActionResult<DeviceModelRowData>> {
  const gate = await requireAdmin(PERMISSIONS.DEVICE_MODELS_MANAGE);
  if (!gate.ok) return gate;

  const parsed = updateDeviceModelActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  try {
    const model = await updateDeviceModel(parsed.data.id, parsed.data.patch);
    await writeAudit({
      actorType: "admin",
      actorId: gate.adminId,
      action: "device_model.update",
      entity: "DeviceModel",
      entityId: model.id,
      diff: parsed.data.patch,
    });
    revalidatePath(MODELS_PATH);
    return { ok: true, data: model };
  } catch (error) {
    if (error instanceof DuplicateDeviceModelError) {
      return { ok: false, error: error.message };
    }
    console.error("[actions/device-models] update failed:", error);
    return { ok: false, error: "Could not update the model. Please retry." };
  }
}

export async function setDeviceModelStatusAction(
  input: unknown,
): Promise<ActionResult<DeviceModelRowData>> {
  const gate = await requireAdmin(PERMISSIONS.DEVICE_MODELS_MANAGE);
  if (!gate.ok) return gate;

  const parsed = setDeviceModelStatusActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  try {
    const model = await setDeviceModelStatus(parsed.data.id, parsed.data.status);
    await writeAudit({
      actorType: "admin",
      actorId: gate.adminId,
      action: "device_model.status",
      entity: "DeviceModel",
      entityId: model.id,
      diff: { status: model.status },
    });
    revalidatePath(MODELS_PATH);
    return { ok: true, data: model };
  } catch (error) {
    console.error("[actions/device-models] status failed:", error);
    return { ok: false, error: "Could not change the model status." };
  }
}

export async function deleteDeviceModelAction(
  input: unknown,
): Promise<ActionResult> {
  const gate = await requireAdmin(PERMISSIONS.DEVICE_MODELS_MANAGE);
  if (!gate.ok) return gate;

  const parsed = deleteDeviceModelActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  try {
    await deleteDeviceModel(parsed.data.id);
    await writeAudit({
      actorType: "admin",
      actorId: gate.adminId,
      action: "device_model.delete",
      entity: "DeviceModel",
      entityId: parsed.data.id,
    });
    revalidatePath(MODELS_PATH);
    return { ok: true };
  } catch (error) {
    if (error instanceof DeviceModelInUseError) {
      return { ok: false, error: error.message };
    }
    console.error("[actions/device-models] delete failed:", error);
    return { ok: false, error: "Could not delete the model. Please retry." };
  }
}

export async function bulkCreateDeviceModelsAction(
  input: unknown,
): Promise<ActionResult<BulkCreateReport>> {
  const gate = await requireAdmin(PERMISSIONS.DEVICE_MODELS_MANAGE);
  if (!gate.ok) return gate;

  const parsed = bulkCreateDeviceModelsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  try {
    const report = await bulkCreateDeviceModels(parsed.data.text);
    await writeAudit({
      actorType: "admin",
      actorId: gate.adminId,
      action: "device_model.bulk_create",
      entity: "DeviceModel",
      entityId: "bulk",
      diff: {
        created: report.created,
        skipped: report.skippedExisting.length,
        invalid: report.invalid.length,
      },
    });
    revalidatePath(MODELS_PATH);
    return { ok: true, data: report };
  } catch (error) {
    console.error("[actions/device-models] bulk create failed:", error);
    return { ok: false, error: "Bulk import failed. Please retry." };
  }
}

/* ------------------------------------------------------------------ */
/* Customer-facing search (allocation builder)                         */
/* ------------------------------------------------------------------ */

export async function searchDeviceModelsAction(
  input: unknown,
): Promise<ActionResult<DeviceModelOption[]>> {
  const viewer = await resolveViewer();
  // Admins may search too (product editor's restriction picker reuses this).
  if (!isCustomer(viewer) && !isAdmin(viewer)) {
    return { ok: false, error: "Sign in to search models." };
  }

  const parsed = searchDeviceModelsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const principal = isCustomer(viewer) ? viewer.customerId : viewer.adminId;
  const rl = await limit(principal, { points: 60, window: 60 }, "model-search");
  if (!rl.ok) {
    return { ok: false, error: "Searching too fast — wait a moment." };
  }

  // Scope to the product's allocation restriction when a productId is given,
  // so a restricted product's picker can only ever surface allowed models.
  let ids: string[] | null = null;
  if (parsed.data.productId) {
    const product = await prisma.product.findUnique({
      where: { id: parsed.data.productId },
      select: {
        allocation: true,
        category: { select: { defaultAllocation: true } },
      },
    });
    const alloc =
      parseAllocation(product?.allocation) ??
      parseAllocation(product?.category?.defaultAllocation);
    if (alloc && alloc.modelIds.length > 0) ids = alloc.modelIds;
  }

  const models = await searchDeviceModels(parsed.data.query, {
    limit: parsed.data.limit,
    ids,
  });
  return { ok: true, data: models };
}
