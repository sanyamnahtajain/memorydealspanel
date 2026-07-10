import "server-only";

import { prisma } from "@/server/db";
import { assertAdmin } from "@/server/dal/guard";
import { resolveViewer } from "@/server/auth/viewer";
import { summarizeDiff } from "@/lib/audit-format";

/**
 * Audit-log read service.
 *
 * The single admin-only entry point for surfacing recent `AuditLog` rows in the
 * admin UI (the {@link AuditLogPreview} timeline and the module-level
 * {@link RecentActivityPanel}). Both queries:
 *   - hit an existing index (`[entity, entityId]` for the per-entity read,
 *     `[createdAt]` for the module read), newest first;
 *   - resolve the human actor name (batched Admin lookup) so the UI never has
 *     to; and
 *   - assert the caller is an admin via `resolveViewer` + `assertAdmin` so
 *     audit history NEVER leaks to customers or anonymous viewers.
 *
 * The returned {@link AuditPreviewEntry} is a plain, serialisable shape safe to
 * hand straight to a Server Component (no `Date` — `createdAt` is an ISO
 * string; `diff` is pre-summarised to a short `diffSummary` string).
 */

/** Serialisable, presentation-ready audit row. */
export interface AuditPreviewEntry {
  id: string;
  /** Resolved human actor name; falls back to the raw actorId. */
  actorName: string;
  /** "admin" | "customer" | "system" — drives the avatar tint. */
  actorType: string;
  /** Raw action key, e.g. "product.update" (humanized in the component). */
  action: string;
  entity: string;
  entityId: string;
  /** Short humanized diff, e.g. "name, price" or "status → APPROVED". */
  diffSummary: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/** Minimal DB projection we need from an AuditLog row. */
interface AuditRow {
  id: string;
  actorType: string;
  actorId: string;
  action: string;
  entity: string;
  entityId: string;
  diff: unknown;
  createdAt: Date;
}

/**
 * Batch-resolves display names for the admin actors referenced by `rows`.
 * Returns a map of adminId → name. Only `actorType === "admin"` ids are looked
 * up; everything else falls back to the raw actorId at the call site.
 */
async function resolveActorNames(
  rows: readonly AuditRow[],
): Promise<Map<string, string>> {
  const adminIds = Array.from(
    new Set(
      rows.filter((r) => r.actorType === "admin").map((r) => r.actorId),
    ),
  );
  if (adminIds.length === 0) return new Map();

  const admins = await prisma.admin.findMany({
    where: { id: { in: adminIds } },
    select: { id: true, name: true },
  });
  return new Map(admins.map((a) => [a.id, a.name]));
}

/** Maps raw rows + a name lookup into serialisable preview entries. */
function toPreviewEntries(
  rows: readonly AuditRow[],
  names: Map<string, string>,
): AuditPreviewEntry[] {
  return rows.map((row) => ({
    id: row.id,
    actorName:
      row.actorType === "admin"
        ? (names.get(row.actorId) ?? row.actorId)
        : row.actorType === "system"
          ? "System"
          : row.actorId,
    actorType: row.actorType,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    diffSummary: summarizeDiff(row.diff),
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * Recent audit entries for one specific entity instance (the change history of
 * a single product, customer, role, …), newest first. Admin-only.
 *
 * @param entity   Entity type, e.g. "Product".
 * @param entityId The specific record id.
 * @param limit    Max rows (default 5).
 */
export async function getRecentAuditForEntity(
  entity: string,
  entityId: string,
  limit = 5,
): Promise<AuditPreviewEntry[]> {
  const viewer = await resolveViewer();
  assertAdmin(viewer);

  const rows = (await prisma.auditLog.findMany({
    where: { entity, entityId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      actorType: true,
      actorId: true,
      action: true,
      entity: true,
      entityId: true,
      diff: true,
      createdAt: true,
    },
  })) as AuditRow[];

  const names = await resolveActorNames(rows);
  return toPreviewEntries(rows, names);
}

/** A page of audit rows for the full viewer at /admin/audit. */
export interface AuditPage {
  entries: AuditPreviewEntry[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

/**
 * Paginated audit log for the full viewer (`/admin/audit`). Admin-only.
 * Optionally filtered by entity and/or a specific entityId (used by the
 * "View all" links on the contextual previews).
 */
export async function listAudit(options: {
  entity?: string;
  entityId?: string;
  page?: number;
  pageSize?: number;
}): Promise<AuditPage> {
  const viewer = await resolveViewer();
  assertAdmin(viewer);

  const pageSize = Math.min(Math.max(options.pageSize ?? 25, 1), 100);
  const page = Math.max(options.page ?? 1, 1);

  const where: { entity?: string; entityId?: string } = {};
  if (options.entity) where.entity = options.entity;
  if (options.entityId) where.entityId = options.entityId;

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        actorType: true,
        actorId: true,
        action: true,
        entity: true,
        entityId: true,
        diff: true,
        createdAt: true,
      },
    }) as Promise<AuditRow[]>,
  ]);

  const names = await resolveActorNames(rows);
  return {
    entries: toPreviewEntries(rows, names),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    pageSize,
  };
}

/**
 * Recent audit entries across a whole entity type (module-level "recent
 * activity", e.g. the latest changes to any Product), newest first. Admin-only.
 *
 * @param entity Entity type, e.g. "Product".
 * @param limit  Max rows (default 8).
 */
export async function getRecentAuditForModule(
  entity: string,
  limit = 8,
): Promise<AuditPreviewEntry[]> {
  const viewer = await resolveViewer();
  assertAdmin(viewer);

  const rows = (await prisma.auditLog.findMany({
    where: { entity },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      actorType: true,
      actorId: true,
      action: true,
      entity: true,
      entityId: true,
      diff: true,
      createdAt: true,
    },
  })) as AuditRow[];

  const names = await resolveActorNames(rows);
  return toPreviewEntries(rows, names);
}
