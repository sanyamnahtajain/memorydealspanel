"use server";

import {
  getRecentAuditForEntity,
  type AuditPreviewEntry,
} from "@/server/services/audit-query";

/**
 * Client-callable wrapper around {@link getRecentAuditForEntity} so client
 * components (e.g. the CustomerProfileDrawer) can lazily fetch the change
 * history for a single entity instance. The underlying service asserts the
 * caller is an admin, so this never leaks audit data to customers or anonymous
 * viewers; any thrown auth error is swallowed here and surfaced as an empty
 * list, keeping the calling UI resilient.
 */
export async function getEntityAuditAction(
  entity: string,
  entityId: string,
  limit = 5,
): Promise<AuditPreviewEntry[]> {
  try {
    return await getRecentAuditForEntity(entity, entityId, limit);
  } catch {
    return [];
  }
}
