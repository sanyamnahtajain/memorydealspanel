import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ViewerContext } from "@/server/types/viewer";

/**
 * saveCartNoticeAction end-to-end at the action layer: guard → zod → service
 * → audit. Run against the local test DB with the viewer swapped per test —
 * the same proof the UI form's Save produces, minus the browser.
 */

const viewerMock = vi.hoisted(() => ({
  current: null as ViewerContext | null,
}));

vi.mock("@/server/auth/viewer", () => ({
  resolveViewer: vi.fn(async () => {
    if (!viewerMock.current) throw new Error("no viewer set in test");
    return viewerMock.current;
  }),
}));

// The action revalidates the settings + cart paths; outside a request that
// throws, so neuter it (the tests assert persistence, not cache behaviour).
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/server/db";
import { getCartNotice } from "@/server/services/store-settings";
import { saveCartNoticeAction } from "./store-settings";

// assertPermission re-reads the admin row by id, so the viewer must carry a
// REAL admin id from the seeded DB (a fake string is not even a valid
// ObjectId and fails before the permission check).
let adminId = "";

beforeEach(async () => {
  if (!adminId) {
    const admin = await prisma.admin.findFirst({ select: { id: true } });
    adminId = admin!.id;
  }
  viewerMock.current = {
    kind: "admin",
    adminId,
    name: "Notice Admin",
    roleId: null,
    permissions: ["*"],
  };
});

afterAll(async () => {
  await prisma.storeSettings.updateMany({ data: { cartNotice: null } });
  await prisma.auditLog.deleteMany({
    where: { action: "store_settings.cart_notice" },
  });
});

describe("saveCartNoticeAction", () => {
  it("persists the owner's copy and writes an audit row", async () => {
    const copy =
      "ERD Portronics Digitek Ambrane Zebronics Prices Are With GST bill";
    const result = await saveCartNoticeAction({ cartNotice: copy });
    expect(result).toEqual({ ok: true });
    expect(await getCartNotice()).toBe(copy);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "store_settings.cart_notice" },
    });
    expect(audit).not.toBeNull();
  });

  it("clears on null and rejects over-length copy", async () => {
    const cleared = await saveCartNoticeAction({ cartNotice: null });
    expect(cleared).toEqual({ ok: true });
    expect(await getCartNotice()).toBeNull();

    const tooLong = await saveCartNoticeAction({
      cartNotice: "x".repeat(600),
    });
    expect(tooLong.ok).toBe(false);
  });

  it("refuses a non-admin viewer", async () => {
    viewerMock.current = { kind: "anon" };
    const result = await saveCartNoticeAction({ cartNotice: "nope" });
    expect(result.ok).toBe(false);
    expect(await getCartNotice()).toBeNull();
  });
});
