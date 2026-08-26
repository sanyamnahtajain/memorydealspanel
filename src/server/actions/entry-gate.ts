"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { resolveViewer } from "@/server/auth/viewer";
import { assertAdmin, isForbiddenError } from "@/server/dal/guard";
import { assertPermission } from "@/server/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { writeAudit } from "@/server/security/audit";
import { createLimiter } from "@/server/security/ratelimit";
import { entryGateSchema, normalizeEntryCode } from "@/lib/entry-gate";
import {
  getEntryGate,
  hasPassedEntryGate,
  passEntryGate,
  updateEntryGate,
} from "@/server/auth/entry-gate";

/**
 * Entry-gate actions. Customer side: try a code, check status. Admin side:
 * turn the gate on/off and change the code. See src/lib/entry-gate.ts for the
 * design and its limits.
 */

export type ActionResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

async function guarded<T>(
  run: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (error) {
    if (isForbiddenError(error)) {
      return { ok: false, error: "You are not allowed to do that." };
    }
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues[0]?.message ?? "Invalid input." };
    }
    console.error("[actions/entry-gate] unexpected error:", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/**
 * Guess protection. Tight per identity: a person typing a code they were
 * given needs a handful of tries for typos, and nothing more. A short code
 * survives only as long as guessing is expensive.
 */
const entryGateLimiter = createLimiter({ points: 8, window: 300 }, "entry-gate");

async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return h.get("x-real-ip")?.trim() || "unknown";
}

const attemptSchema = z.object({
  code: z.string().trim().min(1, "Enter the shop code.").max(64),
});

/** Customer: try the shop code. Success remembers this device. */
export async function enterShopCodeAction(
  input: z.input<typeof attemptSchema>,
): Promise<ActionResult<{ passed: true }>> {
  return guarded<{ passed: true }>(async () => {
    const { code } = attemptSchema.parse(input);

    const ip = await clientIp();
    const limited = await entryGateLimiter.limit(ip);
    if (!limited.ok) {
      return {
        ok: false,
        error: "Too many tries. Please wait a few minutes and try again.",
      };
    }

    const passed = await passEntryGate(code);
    if (!passed) {
      return {
        ok: false,
        error: "That code is not right. Ask The Memory Deals for the shop code.",
      };
    }
    return { ok: true, passed: true };
  });
}

/**
 * Customer: does this device need the code right now? Read-only; used by the
 * request-access surfaces to decide whether to show the gate screen.
 */
export async function entryGateStatusAction(): Promise<
  ActionResult<{ required: boolean }>
> {
  return guarded<{ required: boolean }>(async () => {
    const gate = await getEntryGate();
    if (!gate.enabled) return { ok: true, required: false };
    return { ok: true, required: !(await hasPassedEntryGate(gate)) };
  });
}

/* ------------------------------------------------------------------ */
/* admin                                                               */
/* ------------------------------------------------------------------ */

const saveSchema = z.object({
  enabled: z.boolean(),
  code: z
    .string()
    .trim()
    .max(32, "Keep the code under 32 characters.")
    // Only enforce the minimum when the gate is ON — an admin turning it off
    // should not be blocked by whatever is left in the code box.
    .optional()
    .default(""),
});

/** Admin: turn the gate on/off and set the code. */
export async function saveEntryGateAction(
  input: z.input<typeof saveSchema>,
): Promise<ActionResult<{ enabled: boolean }>> {
  return guarded<{ enabled: boolean }>(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.SETTINGS_MANAGE);

    const { enabled, code } = saveSchema.parse(input);
    const normalized = normalizeEntryCode(code);

    if (enabled) {
      const parsed = entryGateSchema.safeParse({ enabled, code: normalized });
      if (!parsed.success) {
        return {
          ok: false,
          error: "The code needs at least 4 characters.",
        };
      }
      await updateEntryGate(parsed.data);
    } else {
      // Keep the last code around so switching back on does not force
      // inventing a new one; disabled means it is simply not asked for.
      await updateEntryGate({ enabled: false, code: normalized });
    }

    await writeAudit({
      actorType: "admin",
      actorId: viewer.adminId,
      action: "settings.entryGate",
      entity: "StoreSettings",
      entityId: "default",
      // The code itself stays out of the audit log on purpose — logs are
      // read in more places than the settings screen is.
      diff: { enabled, codeChanged: normalized.length > 0 },
    });

    revalidatePath("/admin/settings");
    revalidatePath("/account/request-access");
    return { ok: true, enabled };
  });
}

/** Admin: read the current gate (including the code — the owner shares it). */
export async function getEntryGateAction(): Promise<
  ActionResult<{ enabled: boolean; code: string }>
> {
  return guarded<{ enabled: boolean; code: string }>(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.SETTINGS_MANAGE);
    const gate = await getEntryGate();
    return { ok: true, enabled: gate.enabled, code: gate.code };
  });
}
