import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";

/**
 * Audit trail writer.
 *
 * Auditing must never break the operation being audited: `writeAudit` is
 * fire-and-forget safe — it never throws (and never rejects), it only logs
 * failures. Callers may `await` it when they want ordering, or drop the
 * promise entirely.
 */

export interface AuditEntry {
  /** "admin" | "customer" | "system" */
  actorType: string;
  actorId: string;
  /** e.g. "product.create", "customer.approve", "grant.revoke" */
  action: string;
  /** Entity type, e.g. "Product", "Customer" */
  entity: string;
  entityId: string;
  /** Optional before/after snapshot or field-level changes. */
  diff?: Prisma.InputJsonValue;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorType: entry.actorType,
        actorId: entry.actorId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        diff: entry.diff,
      },
    });
  } catch (error) {
    console.error(
      `[audit] failed to write audit log (${entry.action} on ${entry.entity}/${entry.entityId}):`,
      error,
    );
  }
}
