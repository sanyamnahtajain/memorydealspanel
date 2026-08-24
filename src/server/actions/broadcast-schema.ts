import { z } from "zod";

import { objectIdSchema } from "@/lib/schemas/shared";
import {
  BROADCAST_BODY_MAX,
  BROADCAST_SEGMENTS,
  BROADCAST_TITLE_MAX,
  isAppRelativeUrl,
} from "@/lib/broadcast";

/**
 * Schemas + client-facing types for the broadcast composer.
 *
 * They live HERE, not in `./broadcast`, because a `"use server"` module may
 * only export async functions — a zod schema or an exported type there is a
 * build error. The action file imports from this sibling, so validation stays
 * next to the rules it enforces.
 */

export type ActionResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

export const broadcastAudienceSchema = z.enum(["customer", "admin"]);
export const broadcastSegmentSchema = z.enum(BROADCAST_SEGMENTS);

/** The deep link a tap opens. App-relative only — see `isAppRelativeUrl`. */
export const broadcastUrlSchema = z
  .string()
  .trim()
  .max(300, "That link is too long.")
  .refine(
    isAppRelativeUrl,
    "The link must be a page in this app and start with “/” — for example /products.",
  );

const targetShape = {
  audience: broadcastAudienceSchema,
  segment: broadcastSegmentSchema.default("all"),
  customerId: objectIdSchema.nullish(),
};

/** A single customer must actually be named when the segment says so. */
function requireCustomerForOne(
  value: {
    audience: "customer" | "admin";
    segment: string;
    customerId?: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (
    value.audience === "customer" &&
    value.segment === "one" &&
    !value.customerId
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["customerId"],
      message: "Pick the customer you want to message.",
    });
  }
}

export const previewAudienceSchema = z
  .object(targetShape)
  .superRefine(requireCustomerForOne);

export type PreviewAudienceInput = z.input<typeof previewAudienceSchema>;

export const sendBroadcastSchema = z
  .object({
    ...targetShape,
    title: z
      .string()
      .trim()
      .min(1, "Write a short title.")
      .max(
        BROADCAST_TITLE_MAX,
        `Keep the title under ${BROADCAST_TITLE_MAX} letters.`,
      ),
    body: z
      .string()
      .trim()
      .min(1, "Write the message.")
      .max(
        BROADCAST_BODY_MAX,
        `Keep the message under ${BROADCAST_BODY_MAX} letters.`,
      ),
    url: broadcastUrlSchema.nullish(),
  })
  .superRefine(requireCustomerForOne);

export type SendBroadcastInput = z.input<typeof sendBroadcastSchema>;
