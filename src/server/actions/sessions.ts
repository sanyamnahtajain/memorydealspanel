"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { objectIdSchema } from "@/lib/schemas/shared";
import { resolveViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { writeAudit } from "@/server/security/audit";
import {
  revokeSessionById,
  revokeAllForSubject,
} from "@/server/services/sessions";

/**
 * "use server" action wrappers for the admin Sessions viewer.
 *
 * A "use server" module may export ONLY async functions — no exported const /
 * schema. Every mutating action here:
 *   1. resolves the viewer and enforces admin (never throws across the client
 *      boundary — returns a typed error result instead),
 *   2. validates input with zod,
 *   3. delegates to the auth-free session service,
 *   4. writes an audit entry and revalidates /admin/sessions.
 *
 * Revoking is a security-sensitive "force logout": it soft-deletes the Session
 * row so `getSession` immediately rejects that cookie on the next request.
 */

const SESSIONS_PATH = "/admin/sessions";

export type SessionActionResult =
  | { ok: true; count?: number }
  | { ok: false; error: string };

const kindSchema = z.enum(["admin", "customer"]);

const revokeSchema = z.object({ id: objectIdSchema });
const revokeAllSchema = z.object({
  kind: kindSchema,
  id: objectIdSchema,
});

/** Resolve the acting admin id, or a typed error for the client. */
async function requireAdmin(): Promise<
  { ok: true; adminId: string } | { ok: false; error: string }
> {
  const viewer = await resolveViewer();
  if (!isAdmin(viewer)) {
    return { ok: false, error: "You must be signed in as an admin." };
  }
  return { ok: true, adminId: viewer.adminId };
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input.";
}

/**
 * Force-logout a single session (by id). Idempotent — revoking an already-gone
 * session still succeeds. Admins may revoke their OWN current session (a valid
 * "sign out this device") which self-cleans on the next request.
 */
export async function revokeSessionAction(
  input: unknown,
): Promise<SessionActionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  try {
    const target = await revokeSessionById(parsed.data.id);
    if (!target) {
      return { ok: false, error: "That session no longer exists." };
    }

    await writeAudit({
      actorType: "admin",
      actorId: auth.adminId,
      action: "session.revoke",
      entity: "Session",
      entityId: parsed.data.id,
      diff: { subjectKind: target.kind, subjectId: target.subjectId },
    });

    revalidatePath(SESSIONS_PATH);
    return { ok: true, count: 1 };
  } catch {
    return { ok: false, error: "Failed to sign out that session." };
  }
}

/**
 * Force-logout every active session for one subject (admin or customer) —
 * "Sign out all devices".
 */
export async function revokeAllForSubjectAction(
  input: unknown,
): Promise<SessionActionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const parsed = revokeAllSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  try {
    const count = await revokeAllForSubject(parsed.data.kind, parsed.data.id);

    await writeAudit({
      actorType: "admin",
      actorId: auth.adminId,
      action: "session.revokeAll",
      entity: parsed.data.kind === "admin" ? "Admin" : "Customer",
      entityId: parsed.data.id,
      diff: { subjectKind: parsed.data.kind, count },
    });

    revalidatePath(SESSIONS_PATH);
    return { ok: true, count };
  } catch {
    return { ok: false, error: "Failed to sign out those sessions." };
  }
}
