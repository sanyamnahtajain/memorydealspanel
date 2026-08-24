import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import type { BillingGroupInput } from "@/lib/schemas/billing-group";
import {
  BillingGroupCodeTakenError,
  BillingGroupNotFoundError,
  createBillingGroup,
  deleteBillingGroup,
  getBillingGroup,
  listActiveBillingGroupConfigs,
  listBillingGroups,
  setBillingGroupActive,
  updateBillingGroup,
} from "./billing-groups";

/**
 * Integration tests for the billing-group service against the local MongoDB.
 * Every test cleans up the rows it creates so re-runs stay deterministic.
 */

const created: string[] = [];

function track<T extends { id: string }>(row: T): T {
  created.push(row.id);
  return row;
}

afterEach(async () => {
  if (created.length === 0) return;
  await prisma.billingGroup.deleteMany({ where: { id: { in: created } } });
  created.length = 0;
});

const BRAND_A = "0123456789abcdef01234567";
const BRAND_B = "0123456789abcdef01234568";

/** Unique 6-char code per call so parallel/re-runs never collide. */
function freshCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z0-9]/g, "X");
}

function input(overrides: Partial<BillingGroupInput> = {}): BillingGroupInput {
  return {
    name: `Test group ${Date.now()}`,
    code: freshCode(),
    color: "blue",
    active: true,
    sortOrder: 0,
    matcher: { kind: "brands", brandIds: [BRAND_A] },
    rules: [
      {
        kind: "tieredPercent",
        tiers: [
          { fromPaise: 0, percentBps: 400 },
          { fromPaise: 2_500_000, percentBps: 600 },
        ],
      },
    ],
    separateBill: true,
    couponStacking: true,
    notes: null,
    ...overrides,
  };
}

describe("billing-groups service", () => {
  it("creates, lists, reads and updates a group", async () => {
    const group = track(await createBillingGroup(input({ name: "Dealer brands" })));
    expect(group.name).toBe("Dealer brands");
    expect(group.matcher).toEqual({ kind: "brands", brandIds: [BRAND_A] });
    expect(group.rules[0].kind).toBe("tieredPercent");
    expect(group.rules[0].tiers).toHaveLength(2);

    const listed = await listBillingGroups();
    expect(listed.some((g) => g.id === group.id)).toBe(true);

    const fetched = await getBillingGroup(group.id);
    expect(fetched?.code).toBe(group.code);

    const updated = await updateBillingGroup(
      group.id,
      input({
        name: "Dealer brands v2",
        code: group.code,
        matcher: { kind: "brands", brandIds: [BRAND_A, BRAND_B] },
        notes: "Net 30",
      }),
    );
    expect(updated.name).toBe("Dealer brands v2");
    expect(updated.matcher.brandIds).toEqual([BRAND_A, BRAND_B]);
    expect(updated.notes).toBe("Net 30");
  });

  it("rejects a duplicate code with BillingGroupCodeTakenError", async () => {
    const first = track(await createBillingGroup(input()));
    await expect(createBillingGroup(input({ code: first.code }))).rejects.toBeInstanceOf(
      BillingGroupCodeTakenError,
    );

    const other = track(await createBillingGroup(input()));
    await expect(
      updateBillingGroup(other.id, input({ code: first.code })),
    ).rejects.toBeInstanceOf(BillingGroupCodeTakenError);
  });

  it("toggles active and deletes", async () => {
    const group = track(await createBillingGroup(input()));

    const off = await setBillingGroupActive(group.id, false);
    expect(off.active).toBe(false);
    const on = await setBillingGroupActive(group.id, true);
    expect(on.active).toBe(true);

    await deleteBillingGroup(group.id);
    expect(await getBillingGroup(group.id)).toBeNull();
    await expect(deleteBillingGroup(group.id)).rejects.toBeInstanceOf(
      BillingGroupNotFoundError,
    );
    created.splice(created.indexOf(group.id), 1);
  });

  it("listActiveBillingGroupConfigs ignores inactive and malformed rows", async () => {
    const active = track(await createBillingGroup(input({ name: "Active" })));
    const inactive = track(
      await createBillingGroup(input({ name: "Inactive", active: false })),
    );
    // A hand-edited row with rules this build can't parse — must be excluded,
    // never thrown.
    const malformed = track(
      await prisma.billingGroup.create({
        data: {
          name: "Malformed",
          code: freshCode(),
          color: "blue",
          active: true,
          sortOrder: 0,
          matcher: { kind: "brands", brandIds: [BRAND_A] },
          rules: [{ kind: "flatOff", amountPaise: "oops" }],
          separateBill: true,
          couponStacking: true,
        },
        select: { id: true },
      }),
    );

    const configs = await listActiveBillingGroupConfigs();
    const ids = configs.map((g) => g.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(inactive.id);
    expect(ids).not.toContain(malformed.id);

    // The admin list still shows the malformed row, but as inactive.
    const all = await listBillingGroups();
    expect(all.find((g) => g.id === malformed.id)?.active).toBe(false);
  });
});
