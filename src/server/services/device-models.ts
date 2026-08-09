import type { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { makeUniqueSlug } from "@/lib/slug";
import type { EntityStatus } from "@/lib/schemas/shared";
import {
  createDeviceModelSchema,
  updateDeviceModelSchema,
  type CreateDeviceModelInput,
  type UpdateDeviceModelInput,
} from "@/lib/schemas/device-model";
import { parseAllocation } from "@/lib/allocation";

/**
 * DeviceModel master service (the Brand-service pattern).
 *
 * Owns every model mutation: slug generation, bulk paste import, lifecycle.
 * Transport concerns (auth, audit, revalidation) live in
 * `@/server/actions/device-models`.
 *
 * DELETE POLICY: a model referenced by any product's allocation restriction or
 * any live cart breakdown refuses to delete — deactivate instead. Order
 * snapshots carry model NAMES (frozen), so history never blocks lifecycle.
 */

const MODEL_SELECT = {
  id: true,
  name: true,
  slug: true,
  brandName: true,
  status: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DeviceModelSelect;

export interface DeviceModelRowData {
  id: string;
  name: string;
  slug: string;
  brandName: string | null;
  status: EntityStatus;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Option shape for pickers: id + display name (+ group label). */
export interface DeviceModelOption {
  id: string;
  name: string;
  brandName: string | null;
}

export class DeviceModelInUseError extends Error {
  constructor() {
    super(
      "This model is referenced by a product or a customer's cart. Deactivate it instead of deleting.",
    );
    this.name = "DeviceModelInUseError";
  }
}

export class DuplicateDeviceModelError extends Error {
  constructor(name: string) {
    super(`A model named "${name}" already exists.`);
    this.name = "DuplicateDeviceModelError";
  }
}

function slugExists(slug: string): Promise<boolean> {
  return prisma.deviceModel
    .findUnique({ where: { slug }, select: { id: true } })
    .then((row) => row !== null);
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** Every model, brand-grouped ordering for the admin manager. */
export function listDeviceModels(): Promise<DeviceModelRowData[]> {
  return prisma.deviceModel.findMany({
    orderBy: [{ brandName: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    select: MODEL_SELECT,
  });
}

/** ACTIVE models as picker options. */
export function listActiveDeviceModels(): Promise<DeviceModelOption[]> {
  return prisma.deviceModel.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ brandName: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, brandName: true },
  });
}

/**
 * Ranked search over ACTIVE models: prefix matches first, then contains —
 * against both the model name and the brand label. Optionally restricted to an
 * explicit id allow-list (a product's allocation restriction).
 */
export async function searchDeviceModels(
  query: string,
  opts: { limit?: number; ids?: string[] | null } = {},
): Promise<DeviceModelOption[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const idFilter =
    opts.ids && opts.ids.length > 0 ? { id: { in: opts.ids } } : {};
  const q = query.trim();

  const base: Prisma.DeviceModelWhereInput = { status: "ACTIVE", ...idFilter };
  const where: Prisma.DeviceModelWhereInput = q
    ? {
        ...base,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { brandName: { contains: q, mode: "insensitive" } },
        ],
      }
    : base;

  const rows = await prisma.deviceModel.findMany({
    where,
    orderBy: [{ brandName: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    take: limit * 2, // over-fetch so prefix ranking has room to reorder
    select: { id: true, name: true, brandName: true },
  });

  if (!q) return rows.slice(0, limit);
  const lower = q.toLowerCase();
  const rank = (m: DeviceModelOption): number => {
    const name = m.name.toLowerCase();
    if (name.startsWith(lower)) return 0;
    if ((m.brandName ?? "").toLowerCase().startsWith(lower)) return 1;
    return 2;
  };
  return rows
    .map((m, i) => ({ m, i, r: rank(m) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.m);
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export async function createDeviceModel(
  input: CreateDeviceModelInput,
): Promise<DeviceModelRowData> {
  const data = createDeviceModelSchema.parse(input);
  const slug = await makeUniqueSlug(data.name, slugExists);
  try {
    return await prisma.deviceModel.create({
      data: {
        name: data.name,
        slug,
        brandName: data.brandName ?? null,
        sortOrder: data.sortOrder,
        status: data.status,
      },
      select: MODEL_SELECT,
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateDeviceModelError(data.name);
    throw error;
  }
}

export async function updateDeviceModel(
  id: string,
  patch: UpdateDeviceModelInput,
): Promise<DeviceModelRowData> {
  const data = updateDeviceModelSchema.parse(patch);
  const update: Prisma.DeviceModelUpdateInput = {};
  if (data.name !== undefined) {
    update.name = data.name;
    // A rename regenerates the slug (Brand behaviour).
    update.slug = await makeUniqueSlug(data.name, slugExists);
  }
  if (data.brandName !== undefined) update.brandName = data.brandName;
  if (data.sortOrder !== undefined) update.sortOrder = data.sortOrder;
  if (data.status !== undefined) update.status = data.status;
  try {
    return await prisma.deviceModel.update({
      where: { id },
      data: update,
      select: MODEL_SELECT,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DuplicateDeviceModelError(data.name ?? "");
    }
    throw error;
  }
}

export function setDeviceModelStatus(
  id: string,
  status: EntityStatus,
): Promise<DeviceModelRowData> {
  return prisma.deviceModel.update({
    where: { id },
    data: { status },
    select: MODEL_SELECT,
  });
}

export async function deleteDeviceModel(id: string): Promise<void> {
  // In-use guard 1: any live cart breakdown referencing this model. The
  // breakdown is JSON, so scan candidate rows (bounded: carts are small).
  const cartRows = await prisma.cartItem.findMany({
    where: { breakdown: { isSet: true } },
    select: { breakdown: true },
    take: 5000,
  });
  const inCart = cartRows.some((row) =>
    Array.isArray(row.breakdown)
      ? (row.breakdown as { modelId?: string }[]).some((e) => e.modelId === id)
      : false,
  );
  if (inCart) throw new DeviceModelInUseError();

  // In-use guard 2: any product allocation restricted to this model.
  const productRows = await prisma.product.findMany({
    where: { allocation: { isSet: true } },
    select: { allocation: true },
    take: 5000,
  });
  const inProduct = productRows.some((row) => {
    const alloc = parseAllocation(row.allocation);
    return alloc ? alloc.modelIds.includes(id) : false;
  });
  if (inProduct) throw new DeviceModelInUseError();

  await prisma.deviceModel.delete({ where: { id } });
}

/* ------------------------------------------------------------------ */
/* Bulk paste import                                                   */
/* ------------------------------------------------------------------ */

export interface BulkCreateReport {
  created: number;
  skippedExisting: string[];
  invalid: string[];
}

/**
 * Import models from pasted text: one per line, optionally
 * "Brand | Model" / "Brand<TAB>Model". Case-insensitive de-dupe within the
 * paste AND against the DB. Never throws on a bad line — it lands in the
 * report so the admin can fix and re-paste (idempotent by design).
 */
export async function bulkCreateDeviceModels(
  text: string,
): Promise<BulkCreateReport> {
  const report: BulkCreateReport = {
    created: 0,
    skippedExisting: [],
    invalid: [],
  };

  const seen = new Set<string>();
  const parsed: { name: string; brandName: string | null }[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\t|\|/).map((p) => p.trim());
    const [brandName, name] =
      parts.length >= 2 && parts[1] ? [parts[0] || null, parts[1]] : [null, parts[0]];
    if (!name || name.length < 2 || name.length > 80) {
      report.invalid.push(line);
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) continue; // silent within-paste de-dupe
    seen.add(key);
    parsed.push({ name, brandName });
  }
  if (parsed.length === 0) return report;

  // One query resolves which names already exist (case-insensitive).
  const existing = await prisma.deviceModel.findMany({
    where: { OR: parsed.map((p) => ({ name: { equals: p.name, mode: "insensitive" as const } })) },
    select: { name: true },
  });
  const existingLower = new Set(existing.map((e) => e.name.toLowerCase()));

  let sortOrder =
    ((await prisma.deviceModel.aggregate({ _max: { sortOrder: true } }))._max
      .sortOrder ?? 0) + 1;

  for (const p of parsed) {
    if (existingLower.has(p.name.toLowerCase())) {
      report.skippedExisting.push(p.name);
      continue;
    }
    const slug = await makeUniqueSlug(p.name, slugExists);
    try {
      await prisma.deviceModel.create({
        data: {
          name: p.name,
          slug,
          brandName: p.brandName,
          sortOrder: sortOrder++,
          status: "ACTIVE",
        },
      });
      report.created += 1;
    } catch (error) {
      // Unique race (concurrent paste) — count as existing, keep going.
      if (isUniqueViolation(error)) report.skippedExisting.push(p.name);
      else throw error;
    }
  }
  return report;
}

/* ------------------------------------------------------------------ */

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
