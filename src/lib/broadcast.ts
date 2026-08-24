/**
 * The broadcast catalogue — the audiences the admin composer can address, the
 * length limits a message must respect, and the one link rule.
 *
 * Pure and client-safe (no server imports), so the composer UI, the zod
 * schemas and the sending service all read the SAME list instead of three
 * copies that drift apart.
 *
 * COPY RULE: the labels and hints here are shown to shop staff, who are not
 * all fluent readers — short, everyday words only.
 */

/** Audience segments for a CUSTOMER broadcast. Staff have no segments. */
export const BROADCAST_SEGMENTS = [
  "all",
  "approved",
  "expiring",
  "expired",
  "one",
] as const;

export type BroadcastSegment = (typeof BROADCAST_SEGMENTS)[number];

/** Longest allowed title. Phones cut off far sooner — this is the hard stop. */
export const BROADCAST_TITLE_MAX = 80;
/** Longest allowed message body. */
export const BROADCAST_BODY_MAX = 300;

export interface BroadcastSegmentInfo {
  key: BroadcastSegment;
  /** Button label in the composer. */
  label: string;
  /** One line saying exactly who this reaches. */
  hint: string;
}

/** Segment picker rows, in the order the composer shows them. */
export const BROADCAST_SEGMENT_INFO: readonly BroadcastSegmentInfo[] = [
  {
    key: "all",
    label: "All customers",
    hint: "Everyone on the list, except blocked shops.",
  },
  {
    key: "approved",
    label: "Approved",
    hint: "Customers who can see prices right now.",
  },
  {
    key: "expiring",
    label: "Ending soon",
    hint: "Their price access stops within 7 days.",
  },
  {
    key: "expired",
    label: "Access ended",
    hint: "Their price access has already stopped.",
  },
  {
    key: "one",
    label: "One customer",
    hint: "Message a single shop.",
  },
] as const;

/**
 * Is this a link INSIDE the app?
 *
 * Only app-relative links are allowed in a broadcast: the composer must not
 * become a way to send every customer in the shop off to another website,
 * whether by a slip of the finger or by a staff login someone got hold of.
 * `//other.example` is a protocol-relative ABSOLUTE url, so it is refused too.
 */
export function isAppRelativeUrl(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("/") && !trimmed.startsWith("//");
}
