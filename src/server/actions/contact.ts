"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { prisma } from "@/server/db";
import { resolveViewer } from "@/server/auth/viewer";
import { assertAdmin, isForbiddenError } from "@/server/dal/guard";
import { writeAudit } from "@/server/security/audit";
import { createLimiter } from "@/server/security/ratelimit";
import {
  consumeSignupHandoff,
  refundSignupHandoff,
} from "@/server/services/google-auth";
import {
  CONTACT_CAP_MESSAGE,
  createContactMessage,
  markContactDone,
} from "@/server/services/contact-messages";
import { objectIdSchema } from "@/lib/schemas/shared";
import {
  contactFormSchema,
  type ContactSubmitResult,
} from "./contact-schema";

/**
 * Contact-us server actions.
 *
 * The PUBLIC submit is open to non-customers — but only ones who proved a
 * Google identity (the single-use `g` handoff minted by the OAuth callback),
 * or a signed-in customer reusing their session identity. It must NOT create
 * a Customer, link anything, or grant price access.
 *
 * The admin action follows the guarded<T> ActionResult pattern from
 * `admin-orders.ts`: assertAdmin + zod + writeAudit + revalidatePath, never
 * throwing to the client.
 */

type ActionResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

async function guarded<T>(
  run: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (error) {
    if (isForbiddenError(error)) {
      return { ok: false, error: "You are not authorised to do that." };
    }
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues[0]?.message ?? "Invalid input." };
    }
    console.error("[actions/contact] unexpected error:", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** Best-effort client IP from proxy headers (per-IP flood limit). */
async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return h.get("x-real-ip")?.trim() || "unknown";
}

/** 5 messages per hour per IP — the wide wall behind the per-account cap. */
const contactIpLimiter = createLimiter({ points: 5, window: 3600 }, "contact-ip");

const submitSchema = z.object({
  form: contactFormSchema,
  /** Single-use Google handoff — absent for signed-in customers. */
  g: z.string().optional(),
});

/**
 * PUBLIC: submit a contact message.
 *
 * Identity, in order of trust:
 *  - a signed-in customer — session identity, no Google step (their email may
 *    be null for phone customers; the message cap then keys on their linked
 *    Google sub, or a `customer:<id>` key when they have none);
 *  - otherwise the `g` handoff, consumed here (single-use).
 *
 * The 3-messages-per-Google-account cap is counted in the DB by the service.
 */
export async function submitContactAction(
  input: z.input<typeof submitSchema>,
): Promise<ContactSubmitResult> {
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please check the form.",
    };
  }
  const { form, g } = parsed.data;

  try {
    const ip = await clientIp();
    const rl = await contactIpLimiter.limit(ip);
    if (!rl.ok) {
      return {
        ok: false,
        error: "Too many messages from this connection. Please try again later.",
      };
    }

    const viewer = await resolveViewer();

    let identity: { googleSub: string; email: string; fallbackName: string | null };
    let consumedToken: string | null = null;

    if (viewer.kind === "customer") {
      // Signed-in customer: no Google step — reuse their session identity.
      const customer = await prisma.customer.findUnique({
        where: { id: viewer.customerId },
        select: { id: true, email: true, contactName: true },
      });
      if (!customer) {
        return { ok: false, error: "Please sign in again and retry." };
      }
      const linked = await prisma.googleAccount.findFirst({
        where: { customerId: customer.id },
        select: { sub: true },
      });
      identity = {
        googleSub: linked?.sub ?? `customer:${customer.id}`,
        email: customer.email ?? "",
        fallbackName: customer.contactName,
      };
    } else {
      const token = typeof g === "string" ? g : "";
      const handoff = token ? await consumeSignupHandoff(token) : null;
      if (!handoff) {
        return {
          ok: false,
          error:
            "Your Google sign-in ran out. Please tap Continue with Google again.",
        };
      }
      consumedToken = token;
      identity = {
        googleSub: handoff.sub,
        email: handoff.email,
        fallbackName: handoff.name,
      };
    }

    try {
      const result = await createContactMessage({
        googleSub: identity.googleSub,
        email: identity.email,
        name: form.name || identity.fallbackName,
        phone: form.phone,
        businessName: form.businessName ?? null,
        city: form.city ?? null,
        reason: form.reason,
      });
      if (!result.ok) {
        // Capped for good — the token is spent, but no retry can succeed
        // anyway, so there is nothing worth refunding.
        return { ok: false, error: CONTACT_CAP_MESSAGE };
      }
    } catch (error) {
      // Nothing was created: restore the single-use token so retrying does
      // not force a fresh Google round-trip (same pattern as request-access).
      if (consumedToken) await refundSignupHandoff(consumedToken);
      throw error;
    }

    revalidatePath("/admin/contact");
    return { ok: true, phone: form.phone };
  } catch (error) {
    console.error("[actions/contact] submit failed:", error);
    return {
      ok: false,
      error: "Could not send your message. Please try again.",
    };
  }
}

const markDoneSchema = z.object({ id: objectIdSchema });

/** ADMIN: mark a contact message handled. */
export async function markContactDoneAction(
  input: z.input<typeof markDoneSchema>,
): Promise<ActionResult<{ id: string }>> {
  return guarded<{ id: string }>(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);

    const { id } = markDoneSchema.parse(input);
    const result = await markContactDone(id, viewer.adminId);
    if (!result.ok) {
      return { ok: false, error: "This message was already marked as done." };
    }

    await writeAudit({
      actorType: "admin",
      actorId: viewer.adminId,
      action: "contact.done",
      entity: "ContactMessage",
      entityId: id,
    });

    revalidatePath("/admin/contact");
    return { ok: true, id };
  });
}
