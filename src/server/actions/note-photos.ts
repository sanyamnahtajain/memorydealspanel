"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveViewer } from "@/server/auth/viewer";
import { isCustomer } from "@/server/types/viewer";
import { createUploadTarget, publicUrl, type UploadTarget } from "@/server/storage/r2";
import { headers } from "next/headers";
import { requestAccessLimiter } from "@/server/security/ratelimit";
import { ATTACHMENT_MAX_BYTES } from "@/lib/requirement-notes";

/**
 * Presigned upload for CUSTOMER requirement photos (cart-line notes). The key
 * is minted server-side under `order-notes/<customerId>/` — the customer can
 * never choose the path, and the cart/order layer only accepts URLs under
 * that prefix, so an attachment always traces to the account that uploaded
 * it. Images only, size-capped; IP rate-limited (same budget class as other
 * unauthenticated-ish writes).
 */

const inputSchema = z.object({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z.number().int().min(1).max(ATTACHMENT_MAX_BYTES),
});

export type NotePhotoPresign =
  | {
      ok: true;
      mode: UploadTarget["mode"];
      uploadUrl: string;
      publicUrl: string;
      headers: Record<string, string>;
    }
  | { ok: false; error: string };

export async function presignNotePhotoAction(input: {
  contentType: string;
  sizeBytes: number;
}): Promise<NotePhotoPresign> {
  const viewer = await resolveViewer();
  if (!isCustomer(viewer)) {
    return { ok: false, error: "Please sign in to attach photos." };
  }
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Only JPEG/PNG/WebP images up to 3 MB are allowed." };
  }
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
  const limited = await requestAccessLimiter.limit(`note-photo:${viewer.customerId}:${ip}`);
  if (!limited.ok) {
    return { ok: false, error: "Too many uploads — please wait a minute." };
  }

  const ext =
    parsed.data.contentType === "image/png"
      ? "png"
      : parsed.data.contentType === "image/webp"
        ? "webp"
        : "jpg";
  const key = `order-notes/${viewer.customerId}/${randomUUID()}.${ext}`;
  const target = await createUploadTarget(key, parsed.data.contentType);
  return {
    ok: true,
    mode: target.mode,
    uploadUrl: target.uploadUrl,
    publicUrl: publicUrl(key),
    headers: target.headers,
  };
}
