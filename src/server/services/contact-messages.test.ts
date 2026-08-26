import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import {
  CONTACT_MESSAGE_LIMIT,
  contactCapReached,
  countContactMessages,
  createContactMessage,
  markContactDone,
} from "./contact-messages";
import { contactFormSchema } from "@/server/actions/contact-schema";

/**
 * Contact-us: the pure validation + cap rules, and the DB-enforced
 * 3-messages-per-Google-account lifetime cap.
 *
 * The DB tests run against the local test Mongo and clean up every row they
 * create (a per-run unique googleSub keeps them isolated from real data).
 */

const RUN_SUB = `test-contact-sub-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const VALID_FORM = {
  name: "Rahul Sharma",
  phone: "98765 43210",
  businessName: "Acme Traders",
  city: "Mumbai",
  reason: "I want to ask about bulk pricing for memory cards.",
};

afterEach(async () => {
  await prisma.contactMessage.deleteMany({
    where: { googleSub: { startsWith: "test-contact-sub-" } },
  });
  await prisma.notification.deleteMany({ where: { type: "contact_message" } });
});

/* ------------------------------------------------------------------ */
/* contactFormSchema (pure)                                            */
/* ------------------------------------------------------------------ */

describe("contactFormSchema", () => {
  it("accepts a valid form and normalizes the phone number", () => {
    const parsed = contactFormSchema.safeParse(VALID_FORM);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.phone).toBe("+919876543210");
      expect(parsed.data.businessName).toBe("Acme Traders");
      expect(parsed.data.city).toBe("Mumbai");
    }
  });

  it("treats empty business name and city as not provided", () => {
    const parsed = contactFormSchema.safeParse({
      ...VALID_FORM,
      businessName: "  ",
      city: "",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.businessName).toBeUndefined();
      expect(parsed.data.city).toBeUndefined();
    }
  });

  it("rejects a non-Indian mobile number", () => {
    const parsed = contactFormSchema.safeParse({
      ...VALID_FORM,
      phone: "12345",
    });
    expect(parsed.success).toBe(false);
  });

  it("requires the phone number", () => {
    const withoutPhone: Record<string, unknown> = { ...VALID_FORM };
    delete withoutPhone.phone;
    const parsed = contactFormSchema.safeParse(withoutPhone);
    expect(parsed.success).toBe(false);
  });

  it("rejects a reason shorter than 10 characters", () => {
    const parsed = contactFormSchema.safeParse({
      ...VALID_FORM,
      reason: "call me",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a reason longer than 1000 characters", () => {
    const parsed = contactFormSchema.safeParse({
      ...VALID_FORM,
      reason: "x".repeat(1001),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a whitespace-padded reason that is too short after trimming", () => {
    const parsed = contactFormSchema.safeParse({
      ...VALID_FORM,
      reason: "   hi there   ",
    });
    expect(parsed.success).toBe(false);
  });

  it("requires a name", () => {
    const parsed = contactFormSchema.safeParse({ ...VALID_FORM, name: " " });
    expect(parsed.success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* contactCapReached (pure)                                            */
/* ------------------------------------------------------------------ */

describe("contactCapReached", () => {
  it("allows the first three messages", () => {
    expect(contactCapReached(0)).toBe(false);
    expect(contactCapReached(1)).toBe(false);
    expect(contactCapReached(2)).toBe(false);
  });

  it("blocks at the limit and beyond", () => {
    expect(contactCapReached(CONTACT_MESSAGE_LIMIT)).toBe(true);
    expect(contactCapReached(CONTACT_MESSAGE_LIMIT + 5)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* createContactMessage — DB-enforced cap                              */
/* ------------------------------------------------------------------ */

describe("createContactMessage", () => {
  const base = {
    googleSub: RUN_SUB,
    email: "buyer@example.com",
    name: "Rahul Sharma",
    phone: "+919876543210",
    businessName: null,
    city: null,
    reason: "I want to ask about bulk pricing for memory cards.",
  };

  it("creates the message and an admin notification row", async () => {
    const result = await createContactMessage(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await prisma.contactMessage.findUnique({
      where: { id: result.id },
    });
    expect(row?.googleSub).toBe(RUN_SUB);
    expect(row?.status).toBe("NEW");

    const notif = await prisma.notification.findFirst({
      where: { type: "contact_message" },
      orderBy: { createdAt: "desc" },
    });
    const payload = notif?.payload as Record<string, unknown> | undefined;
    expect(payload?.contactId).toBe(result.id);
    expect(payload?.phone).toBe("+919876543210");
    // Reason preview is capped at 80 characters.
    expect(String(payload?.reason).length).toBeLessThanOrEqual(80);
  });

  it("refuses the fourth message from the same Google account", async () => {
    const sub = `${RUN_SUB}-cap`;
    for (let i = 0; i < CONTACT_MESSAGE_LIMIT; i += 1) {
      const result = await createContactMessage({ ...base, googleSub: sub });
      expect(result.ok).toBe(true);
    }
    expect(await countContactMessages(sub)).toBe(CONTACT_MESSAGE_LIMIT);

    const fourth = await createContactMessage({ ...base, googleSub: sub });
    expect(fourth).toEqual({ ok: false, error: "capped" });
    // Nothing extra was written.
    expect(await countContactMessages(sub)).toBe(CONTACT_MESSAGE_LIMIT);
  });

  it("caps per account — another account is unaffected", async () => {
    const subA = `${RUN_SUB}-a`;
    const subB = `${RUN_SUB}-b`;
    for (let i = 0; i < CONTACT_MESSAGE_LIMIT; i += 1) {
      await createContactMessage({ ...base, googleSub: subA });
    }
    const other = await createContactMessage({ ...base, googleSub: subB });
    expect(other.ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* markContactDone                                                     */
/* ------------------------------------------------------------------ */

describe("markContactDone", () => {
  it("marks a NEW message done exactly once", async () => {
    const created = await createContactMessage({
      googleSub: `${RUN_SUB}-done`,
      email: "buyer@example.com",
      name: null,
      phone: "+919876543210",
      businessName: null,
      city: null,
      reason: "Please call me back about my last order.",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const adminId = "0123456789abcdef01234567";
    const first = await markContactDone(created.id, adminId);
    expect(first.ok).toBe(true);

    const row = await prisma.contactMessage.findUnique({
      where: { id: created.id },
    });
    expect(row?.status).toBe("DONE");
    expect(row?.handledBy).toBe(adminId);
    expect(row?.handledAt).toBeInstanceOf(Date);

    // Second click / second admin: already handled.
    const second = await markContactDone(created.id, adminId);
    expect(second.ok).toBe(false);
  });
});
