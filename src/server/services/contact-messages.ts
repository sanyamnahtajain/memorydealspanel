import { prisma } from "@/server/db";
import { notifyAdmins } from "@/server/notify/push";

/**
 * Contact-us messages (anyone with a proven Google identity may write to the
 * shop — they are NOT customers, and nothing here creates or links one).
 *
 * Anti-misuse: at most {@link CONTACT_MESSAGE_LIMIT} messages per Google
 * account EVER, counted in the database (never trusted from the client).
 */

export const CONTACT_MESSAGE_LIMIT = 3;

/** Exact owner copy for the cap. */
export const CONTACT_CAP_MESSAGE =
  "You have already sent 3 messages. The shop will reply soon.";

/** Pure cap decision — split out so the rule itself is unit-testable. */
export function contactCapReached(sentCount: number): boolean {
  return sentCount >= CONTACT_MESSAGE_LIMIT;
}

/** How many messages this Google identity has ever sent. */
export async function countContactMessages(googleSub: string): Promise<number> {
  return prisma.contactMessage.count({ where: { googleSub } });
}

export interface NewContactMessage {
  /** Verified Google `sub` — or a `customer:<id>` key for phone customers. */
  googleSub: string;
  /** Verified Google email, or "" for a phone customer without one. */
  email: string;
  name: string | null;
  phone: string;
  businessName: string | null;
  city: string | null;
  reason: string;
}

export type CreateContactResult =
  | { ok: true; id: string }
  | { ok: false; error: "capped" };

/**
 * Create a contact message, enforcing the lifetime cap in the DB, then ring
 * the admin panel: a Notification row (→ the live SSE toast) and a Web Push.
 * Notification failures never fail the message itself.
 */
export async function createContactMessage(
  input: NewContactMessage,
): Promise<CreateContactResult> {
  const sent = await countContactMessages(input.googleSub);
  if (contactCapReached(sent)) return { ok: false, error: "capped" };

  const row = await prisma.contactMessage.create({
    data: {
      googleSub: input.googleSub,
      email: input.email,
      name: input.name,
      phone: input.phone,
      businessName: input.businessName,
      city: input.city,
      reason: input.reason,
    },
  });

  const preview = input.reason.slice(0, 80);
  try {
    await prisma.notification.create({
      data: {
        type: "contact_message",
        payload: {
          contactId: row.id,
          name: input.name ?? "",
          phone: input.phone,
          reason: preview,
        },
      },
    });
  } catch (error) {
    console.error("[contact] failed to persist notification:", error);
  }

  try {
    await notifyAdmins("admin.system", {
      title: "New contact message",
      body: `${input.name || input.phone}: ${preview}`,
      url: "/admin/contact",
      sound: "short",
    });
  } catch (error) {
    console.error("[contact] failed to send admin push:", error);
  }

  return { ok: true, id: row.id };
}

/* ----------------------------------------------------------------------- */
/* Admin list + handling                                                    */
/* ----------------------------------------------------------------------- */

const PAGE_SIZE = 20;

export interface ContactMessageRow {
  id: string;
  email: string;
  name: string | null;
  phone: string;
  businessName: string | null;
  city: string | null;
  reason: string;
  status: string;
  handledAt: Date | null;
  createdAt: Date;
}

export interface ContactMessageList {
  messages: ContactMessageRow[];
  total: number;
  newCount: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

/** Newest first, offset-paginated, with the unhandled ("NEW") count. */
export async function listContactMessages(page: number): Promise<ContactMessageList> {
  const [total, newCount] = await Promise.all([
    prisma.contactMessage.count(),
    prisma.contactMessage.count({ where: { status: "NEW" } }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const clamped = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount);
  const messages = await prisma.contactMessage.findMany({
    orderBy: { createdAt: "desc" },
    skip: (clamped - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      businessName: true,
      city: true,
      reason: true,
      status: true,
      handledAt: true,
      createdAt: true,
    },
  });
  return { messages, total, newCount, page: clamped, pageCount, pageSize: PAGE_SIZE };
}

/**
 * Mark one message DONE. The `status: "NEW"` predicate makes it an atomic
 * claim: a second click (or a second admin) finds nothing to update.
 */
export async function markContactDone(
  id: string,
  adminId: string,
): Promise<{ ok: boolean }> {
  const updated = await prisma.contactMessage.updateMany({
    where: { id, status: "NEW" },
    data: { status: "DONE", handledAt: new Date(), handledBy: adminId },
  });
  return { ok: updated.count === 1 };
}
