/**
 * Requirement notes & photos (customer-supplied per cart line) — the pure
 * validation shared by the cart service, order snapshot, and the client
 * editor, so limits agree everywhere.
 *
 * SECURITY: attachment URLs are ONLY accepted when they point inside OUR
 * public storage under the `order-notes/` prefix — a client can never inject
 * an arbitrary external URL into an order document (which admins open and
 * the PDF embeds server-side).
 */

export const NOTE_MAX_CHARS = 1000;
export const MAX_ATTACHMENTS = 6;
/** Client-side compression target; the presign also caps the upload size. */
export const ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;

export interface RequirementAttachment {
  url: string;
}

/** The public-URL prefix all attachment uploads live under. */
export function attachmentUrlPrefix(publicBase: string): string {
  return `${publicBase.replace(/\/+$/, "")}/order-notes/`;
}

/** Clean + bound a customer note; null when effectively empty. */
export function sanitizeNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, NOTE_MAX_CHARS);
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parse + bound the attachment list, keeping ONLY urls under our prefix.
 * Junk rows drop silently; order is preserved; capped at MAX_ATTACHMENTS.
 */
export function sanitizeAttachments(
  raw: unknown,
  publicBase: string,
): RequirementAttachment[] {
  if (!Array.isArray(raw)) return [];
  // No configured public base ⇒ no URL can be trusted ⇒ keep nothing.
  if (publicBase.replace(/\/+$/, "") === "") return [];
  const prefix = attachmentUrlPrefix(publicBase);
  const out: RequirementAttachment[] = [];
  for (const item of raw) {
    if (out.length >= MAX_ATTACHMENTS) break;
    const url =
      typeof item === "string"
        ? item
        : item && typeof item === "object" && typeof (item as { url?: unknown }).url === "string"
          ? ((item as { url: string }).url)
          : null;
    if (!url || !url.startsWith(prefix)) continue;
    if (out.some((a) => a.url === url)) continue;
    out.push({ url });
  }
  return out;
}
