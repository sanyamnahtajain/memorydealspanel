import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import {
  consumeSignupHandoff,
  createSignupHandoff,
  linkGoogleAccount,
  peekSignupHandoff,
  refundSignupHandoff,
  resolveGoogleCustomer,
} from "./google-auth";

/**
 * Google sign-in service — the security-critical persistence rules:
 *  - signup handoffs are single-use (peek never consumes; refund restores);
 *  - linking is by sub first, then by VERIFIED email only (an unverified
 *    email never links);
 *  - an email match writes the sub link so the next login is direct.
 */

const createdCustomerIds: string[] = [];
const createdSubs: string[] = [];

function identity(over: Partial<{ sub: string; email: string | null; emailVerified: boolean; name: string | null }> = {}) {
  return {
    sub: `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    email: `g${Date.now()}${Math.floor(Math.random() * 1e6)}@example.com`,
    emailVerified: true,
    name: "G Tester",
    ...over,
  };
}

async function makeCustomer(email: string | null): Promise<string> {
  const customer = await prisma.customer.create({
    data: {
      businessName: "Google Test Traders",
      contactName: "G Test",
      phone: `+9177${String(
        (Date.now() + Math.floor(Math.random() * 1e7)) % 1_00_00_00_000,
      ).padStart(10, "0")}`,
      passwordHash: "x".repeat(60),
      email,
      status: "APPROVED",
    },
    select: { id: true },
  });
  createdCustomerIds.push(customer.id);
  return customer.id;
}

afterEach(async () => {
  await prisma.oAuthFlowState.deleteMany({ where: { kind: "signup" } });
  if (createdSubs.length > 0) {
    await prisma.googleAccount.deleteMany({ where: { sub: { in: createdSubs } } });
    createdSubs.length = 0;
  }
  if (createdCustomerIds.length > 0) {
    await prisma.googleAccount.deleteMany({
      where: { customerId: { in: createdCustomerIds } },
    });
    await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    createdCustomerIds.length = 0;
  }
});

describe("signup handoff (single-use, refundable)", () => {
  it("peek is read-only; consume is single-use; refund restores", async () => {
    const id = identity();
    const token = await createSignupHandoff(id);

    expect(await peekSignupHandoff(token)).toMatchObject({ email: id.email, sub: id.sub });
    expect(await peekSignupHandoff(token)).toMatchObject({ email: id.email }); // still there

    expect(await consumeSignupHandoff(token)).toMatchObject({ email: id.email, sub: id.sub });
    expect(await consumeSignupHandoff(token)).toBeNull(); // single-use
    expect(await peekSignupHandoff(token)).toBeNull();

    await refundSignupHandoff(token); // e.g. duplicate-phone failure
    expect(await consumeSignupHandoff(token)).toMatchObject({ email: id.email });
    expect(await consumeSignupHandoff(token)).toBeNull(); // still single-use after
  });
});

describe("resolveGoogleCustomer (linking rules)", () => {
  it("links by VERIFIED email and persists the sub for the next login", async () => {
    const id = identity();
    createdSubs.push(id.sub);
    const customerId = await makeCustomer(id.email);

    const first = await resolveGoogleCustomer(id);
    expect(first).toEqual({ kind: "customer", customerId, blocked: false });

    // The email match wrote the sub link — a second resolve hits it directly
    // (works even if the customer's stored email changes later).
    await prisma.customer.update({ where: { id: customerId }, data: { email: null } });
    const second = await resolveGoogleCustomer(id);
    expect(second).toEqual({ kind: "customer", customerId, blocked: false });
  });

  it("an UNVERIFIED email never links — the visitor is treated as new", async () => {
    const id = identity({ emailVerified: false });
    createdSubs.push(id.sub);
    await makeCustomer(id.email);
    expect(await resolveGoogleCustomer(id)).toEqual({ kind: "new" });
  });

  it("a BLOCKED customer resolves with blocked=true (login refused upstream)", async () => {
    const id = identity();
    createdSubs.push(id.sub);
    const customerId = await makeCustomer(id.email);
    await prisma.customer.update({ where: { id: customerId }, data: { status: "BLOCKED" } });
    expect(await resolveGoogleCustomer(id)).toEqual({ kind: "customer", customerId, blocked: true });
  });

  it("linkGoogleAccount upserts idempotently", async () => {
    const id = identity();
    createdSubs.push(id.sub);
    const customerId = await makeCustomer(null);
    await linkGoogleAccount(id.sub, customerId, id.email!);
    await linkGoogleAccount(id.sub, customerId, id.email!); // no throw
    expect(await resolveGoogleCustomer(id)).toEqual({ kind: "customer", customerId, blocked: false });
  });
});
