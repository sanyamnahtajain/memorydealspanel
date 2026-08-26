import { z } from "zod";

import { indianPhoneSchema } from "@/lib/schemas/customer";
import { emptyStringAsUndefined } from "@/lib/schemas/shared";

/**
 * Contact-us form schema + result types. Sibling module to
 * `src/server/actions/contact.ts` — a "use server" file may only export async
 * functions, so runtime values (zod schemas) and types live here.
 *
 * Copy rules (owner): SIMPLE ENGLISH, and NO GST field — some wholesalers
 * have none and must not be asked.
 */

export const CONTACT_REASON_MIN = 10;
export const CONTACT_REASON_MAX = 1000;

export const contactFormSchema = z.object({
  name: z
    .string("Please write your name")
    .trim()
    .min(2, "Please write your name")
    .max(80, "Your name is too long"),
  /** MANDATORY Indian mobile — same validation as the access-request form. */
  phone: indianPhoneSchema,
  businessName: emptyStringAsUndefined(
    z.string().trim().min(2, "Shop name is too short").max(120, "Shop name is too long"),
  ),
  city: emptyStringAsUndefined(
    z.string().trim().min(2, "City name is too short").max(80, "City name is too long"),
  ),
  reason: z
    .string("Please tell us why you want to contact us")
    .trim()
    .min(
      CONTACT_REASON_MIN,
      "Please write a little more — at least 10 letters",
    )
    .max(CONTACT_REASON_MAX, "Please keep your message under 1000 letters"),
});
export type ContactFormInput = z.infer<typeof contactFormSchema>;

/** What `submitContactAction` returns. `phone` echoes the number they gave. */
export type ContactSubmitResult =
  | { ok: true; phone: string }
  | { ok: false; error: string };
