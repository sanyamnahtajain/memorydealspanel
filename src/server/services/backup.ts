import { gzipSync } from "node:zlib";
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

import { prisma } from "@/server/db";
import { getR2Client } from "@/server/storage/r2";

/**
 * Nightly database snapshot.
 *
 * The M0 tier has NO backups of any kind — no snapshots, no point-in-time
 * recovery — so a bad script or a corrupted document would be unrecoverable.
 * This service dumps every collection to a single gzipped JSON archive in
 * object storage and prunes old ones.
 *
 * ── WHERE IT WRITES ────────────────────────────────────────────────────────
 * A SEPARATE, PRIVATE bucket (`R2_BACKUP_BUCKET`) — never `R2_BUCKET`, which
 * is the PUBLIC images bucket served from `R2_PUBLIC_URL`. This archive holds
 * every customer's name, phone, address and order history; putting it in a
 * world-readable bucket would be a total data breach. The route refuses to
 * run if the backup bucket is unset or accidentally points at the public one.
 *
 * ── WHY A ROTATION, NOT A SINGLE OVERWRITE ─────────────────────────────────
 * Keeping one file that each night replaces the last means the moment you
 * NEED the backup — data was corrupted yesterday and nobody noticed until
 * today — the good copy has already been overwritten by a snapshot of the
 * damage. Keeping a short window costs a few MB and is the difference
 * between a restore and a rewrite.
 */

/** How many daily archives to keep before the oldest is deleted. */
export const BACKUP_KEEP_DAYS = 7;

/** Key prefix inside the backup bucket. */
const PREFIX = "db-snapshots/";

export interface BackupResult {
  key: string;
  /** Compressed archive size in bytes. */
  bytes: number;
  /** Row counts per collection, for the cron's JSON envelope. */
  counts: Record<string, number>;
  /** Keys removed by the retention sweep. */
  pruned: string[];
}

/**
 * The backup bucket. Deliberately a DIFFERENT env var from the public images
 * bucket, and validated to not be the same value — see the header.
 */
function backupBucket(): string {
  const bucket = process.env.R2_BACKUP_BUCKET;
  if (!bucket) {
    throw new Error(
      "R2_BACKUP_BUCKET is not set. Backups must go to a PRIVATE bucket, " +
        "never the public images bucket (R2_BUCKET).",
    );
  }
  if (bucket === process.env.R2_BUCKET) {
    throw new Error(
      "R2_BACKUP_BUCKET must not be the public images bucket — a database " +
        "dump there would be publicly downloadable.",
    );
  }
  return bucket;
}

/**
 * Read every collection. Ordered roughly parents-before-children so a manual
 * restore can be replayed top to bottom without dangling references.
 *
 * Kept as an explicit list rather than reflection over Prisma's DMMF: a new
 * model should be a deliberate decision to include in (or omit from) the
 * backup, not something that silently joins it.
 */
async function dumpCollections(): Promise<Record<string, unknown[]>> {
  const [
    storeSettings,
    sellerTaxProfile,
    roles,
    admins,
    brands,
    categories,
    deviceModels,
    products,
    productVariants,
    coupons,
    billingGroups,
    customers,
    googleAccounts,
    accessGrants,
    accessRequests,
    contactMessages,
    cartItems,
    wishlistItems,
    orders,
    pushSubscriptions,
    notifications,
  ] = await Promise.all([
    prisma.storeSettings.findMany(),
    prisma.sellerTaxProfile.findMany(),
    prisma.role.findMany(),
    prisma.admin.findMany(),
    prisma.brand.findMany(),
    prisma.category.findMany(),
    prisma.deviceModel.findMany(),
    prisma.product.findMany(),
    prisma.productVariant.findMany(),
    prisma.coupon.findMany(),
    prisma.billingGroup.findMany(),
    prisma.customer.findMany(),
    prisma.googleAccount.findMany(),
    prisma.accessGrant.findMany(),
    prisma.accessRequest.findMany(),
    prisma.contactMessage.findMany(),
    prisma.cartItem.findMany(),
    prisma.wishlistItem.findMany(),
    prisma.order.findMany(),
    prisma.pushSubscription.findMany(),
    prisma.notification.findMany(),
  ]);

  // DELIBERATELY OMITTED, and why:
  //   Session         — live credentials; restoring them would resurrect
  //                     logins that were meant to expire. Users re-sign-in.
  //   OAuthFlowState  — single-use, seconds-lived.
  //   PageView        — regenerable analytics; the bulk of the database and
  //                     worthless in a restore (see its TTL index).
  //   AuditLog        — append-only history that would dominate the archive;
  //                     back up separately if it ever becomes a legal need.
  return {
    storeSettings,
    sellerTaxProfile,
    roles,
    admins,
    brands,
    categories,
    deviceModels,
    products,
    productVariants,
    coupons,
    billingGroups,
    customers,
    googleAccounts,
    accessGrants,
    accessRequests,
    contactMessages,
    cartItems,
    wishlistItems,
    orders,
    pushSubscriptions,
    notifications,
  };
}

/** `db-snapshots/memorydeals-2026-08-27.json.gz` */
export function snapshotKey(now: Date): string {
  const stamp = now.toISOString().slice(0, 10);
  return `${PREFIX}memorydeals-${stamp}.json.gz`;
}

/**
 * Which keys a retention sweep should delete: everything except the newest
 * `keep`. Pure, so the policy is testable without touching storage.
 */
export function keysToPrune(keys: string[], keep: number): string[] {
  // Keys embed an ISO date, so lexical sort IS chronological order.
  const sorted = [...keys].sort();
  return sorted.slice(0, Math.max(0, sorted.length - keep));
}

/**
 * Dump → gzip → upload → prune. Returns what happened, for the cron envelope.
 * Throws on failure so the cron reports a non-200 and the failure is visible
 * rather than silently skipped.
 */
export async function runBackup(now: Date = new Date()): Promise<BackupResult> {
  const bucket = backupBucket();
  const client = getR2Client();

  const collections = await dumpCollections();
  const counts: Record<string, number> = {};
  for (const [name, rows] of Object.entries(collections)) {
    counts[name] = rows.length;
  }

  const archive = gzipSync(
    Buffer.from(
      JSON.stringify({
        takenAt: now.toISOString(),
        // Restores are hand-run; record what produced the file.
        source: "memorydeals",
        collections,
      }),
    ),
    { level: 9 },
  );

  const key = snapshotKey(now);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: archive,
      ContentType: "application/gzip",
      // Belt and braces even in a private bucket.
      CacheControl: "private, no-store",
    }),
  );

  // Retention sweep. A failure here must not fail the backup itself — the
  // snapshot is already safely written, and stale extras are harmless.
  let pruned: string[] = [];
  try {
    const listed = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: PREFIX }),
    );
    const keys = (listed.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => typeof k === "string");
    pruned = keysToPrune(keys, BACKUP_KEEP_DAYS);
    for (const stale of pruned) {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: stale }),
      );
    }
  } catch (error) {
    console.error("[backup] retention sweep failed (snapshot is safe):", error);
    pruned = [];
  }

  return { key, bytes: archive.byteLength, counts, pruned };
}
