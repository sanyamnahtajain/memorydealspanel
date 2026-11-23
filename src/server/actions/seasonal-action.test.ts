import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ViewerContext } from "@/server/types/viewer";

const viewerMock = vi.hoisted(() => ({ current: null as ViewerContext | null }));
vi.mock("@/server/auth/viewer", () => ({
  resolveViewer: vi.fn(async () => {
    if (!viewerMock.current) throw new Error("no viewer set in test");
    return viewerMock.current;
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/server/db";
import { DEFAULT_SEASONAL } from "@/lib/seasonal";
import { getSeasonal } from "@/server/services/store-settings";
import { saveSeasonalAction } from "./store-settings";

let adminId = "";
beforeEach(async () => {
  if (!adminId) adminId = (await prisma.admin.findFirst({ select: { id: true } }))!.id;
  viewerMock.current = { kind: "admin", adminId, name: "Seasonal QA", roleId: null, permissions: ["*"] };
});

afterAll(async () => {
  await prisma.storeSettings.updateMany({ data: { seasonal: null } });
  await prisma.auditLog.deleteMany({ where: { action: "store_settings.seasonal" } });
});

describe("saveSeasonalAction", () => {
  it("saves the owner's choice and audits it", async () => {
    const value = { mode: "off", snow: "normal", christmas: false, admin: false, sounds: false } as const;
    expect(await saveSeasonalAction(value)).toEqual({ ok: true });
    expect(await getSeasonal()).toEqual(value);
    const audit = await prisma.auditLog.findFirst({ where: { action: "store_settings.seasonal" }, orderBy: { createdAt: "desc" } });
    expect(audit?.diff).toMatchObject(value);
  });

  it("rejects nonsense and keeps the previous value", async () => {
    await saveSeasonalAction(DEFAULT_SEASONAL);
    const res = await saveSeasonalAction({ mode: "blizzard", snow: "light", christmas: true, admin: true, sounds: true });
    expect(res.ok).toBe(false);
    expect(await getSeasonal()).toEqual(DEFAULT_SEASONAL);
  });
});
