import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Object storage for product images and other uploads.
 *
 * Production: Cloudflare R2 via the S3 API — the browser PUTs directly to a
 * presigned URL and files are served from R2_PUBLIC_URL.
 *
 * Dev fallback (no R2 env): files land under public/uploads/ on local disk,
 * with the same `createUploadTarget` shape, so upload flows work offline.
 * In local mode the returned uploadUrl points at the dev-only API route
 * `/api/dev/upload`, whose handler should call `localDiskFallback.save()`.
 *
 * Required env for R2 mode:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
 *   R2_PUBLIC_URL (public bucket domain / custom domain, no trailing slash)
 */

const PRESIGN_EXPIRES_SECONDS = 600;
const LOCAL_UPLOAD_ROUTE = "/api/dev/upload";
const LOCAL_PUBLIC_PREFIX = "/uploads";

export type UploadTarget =
  | {
      mode: "presigned";
      /** PUT the file body directly to this URL. */
      uploadUrl: string;
      /** Where the object will be publicly readable after upload. */
      publicUrl: string;
      /** Headers the client must send with the PUT. */
      headers: Record<string, string>;
    }
  | {
      mode: "local";
      /** PUT the file body to this dev-only app route. */
      uploadUrl: string;
      publicUrl: string;
      headers: Record<string, string>;
    };

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET &&
      process.env.R2_PUBLIC_URL,
  );
}

const globalForR2 = globalThis as unknown as {
  __memorydealsR2Client: S3Client | undefined;
  __memorydealsLocalUploadWarned: boolean | undefined;
};

/** S3 client pointed at Cloudflare R2. Throws if R2 env is not configured. */
export function getR2Client(): S3Client {
  if (!isR2Configured()) {
    throw new Error(
      "R2 is not configured (set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL). Use createUploadTarget() for the env-aware facade.",
    );
  }
  if (!globalForR2.__memorydealsR2Client) {
    globalForR2.__memorydealsR2Client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return globalForR2.__memorydealsR2Client;
}

/**
 * Normalize a storage key: forward-slash separated, no leading slash, no
 * `.`/`..` segments, safe characters only. Prevents path traversal in the
 * local-disk fallback and keeps R2 keys tidy.
 */
export function sanitizeKey(key: string): string {
  const cleaned = key
    .split("/")
    .map((segment) =>
      segment
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/\.{2,}/g, "."),
    )
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    .join("/");
  if (!cleaned) {
    throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
  }
  return cleaned;
}

/** Public URL for an object key (R2 mode). */
export function publicUrl(key: string): string {
  const base = (process.env.R2_PUBLIC_URL ?? "").replace(/\/+$/, "");
  if (!base) {
    throw new Error("R2_PUBLIC_URL is not set");
  }
  return `${base}/${sanitizeKey(key)}`;
}

/** Presigned PUT URL for direct browser upload to R2. */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
): Promise<string> {
  const client = getR2Client();
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET!,
    Key: sanitizeKey(key),
    ContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn: PRESIGN_EXPIRES_SECONDS });
}

/**
 * Dev-only storage that mimics the R2 interface but writes to
 * public/uploads/ so Next.js serves the files statically.
 */
export const localDiskFallback = {
  createUploadTarget(key: string, contentType: string): UploadTarget {
    const safeKey = sanitizeKey(key);
    return {
      mode: "local",
      uploadUrl: `${LOCAL_UPLOAD_ROUTE}?key=${encodeURIComponent(safeKey)}`,
      publicUrl: `${LOCAL_PUBLIC_PREFIX}/${safeKey}`,
      headers: { "content-type": contentType },
    };
  },

  /**
   * Persist an uploaded body to public/uploads/<key>. Called by the dev-only
   * upload route. Returns the public URL of the stored file.
   */
  async save(key: string, body: Uint8Array): Promise<string> {
    const safeKey = sanitizeKey(key);
    const root = path.join(process.cwd(), "public", "uploads");
    const filePath = path.resolve(root, safeKey);
    if (!filePath.startsWith(root + path.sep)) {
      throw new Error(`Refusing to write outside public/uploads: ${key}`);
    }
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
    return `${LOCAL_PUBLIC_PREFIX}/${safeKey}`;
  },
};

/**
 * Env-aware facade: returns a presigned R2 target when R2 is configured,
 * otherwise a local-disk target for dev. Callers PUT the file body to
 * `uploadUrl` with `headers`, then persist `publicUrl`.
 */
export async function createUploadTarget(
  key: string,
  contentType: string,
): Promise<UploadTarget> {
  if (isR2Configured()) {
    const safeKey = sanitizeKey(key);
    const uploadUrl = await getPresignedUploadUrl(safeKey, contentType);
    return {
      mode: "presigned",
      uploadUrl,
      publicUrl: publicUrl(safeKey),
      headers: { "content-type": contentType },
    };
  }

  if (!globalForR2.__memorydealsLocalUploadWarned) {
    globalForR2.__memorydealsLocalUploadWarned = true;
    console.warn(
      "[storage] R2 env not set — using local disk fallback (public/uploads/). Dev only; files are not durable in serverless environments.",
    );
  }
  return localDiskFallback.createUploadTarget(key, contentType);
}
