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
import { getMaintenance } from "@/server/services/maintenance";
import { saveMaintenanceAction } from "./store-settings";

let adminId = "";

beforeEach(async () => {
  if (!adminId) {
    const admin = await prisma.admin.findFirst({ select: { id: true } });
    adminId = admin!.id;
  }
  viewerMock.current = {
    kind: "admin",
    adminId,
    name: "Maintenance Admin",
    roleId: null,
    permissions: ["*"],
  };
});

afterAll(async () => {
  await prisma.storeSettings.updateMany({ data: { maintenance: null } });
  await prisma.auditLog.deleteMany({
    where: {
      action: { in: ["store_settings.maintenance_on", "store_settings.maintenance_off"] },
    },
  });
});

describe("saveMaintenanceAction", () => {
  it("takes the shop down with a message and a return time, and audits it", async () => {
    const until = new Date(Date.now() + 3_600_000).toISOString();
    const result = await saveMaintenanceAction({
      enabled: true,
      message: "Stock update in progress.",
      until,
    });
    expect(result).toEqual({ ok: true });

    const stored = await getMaintenance();
    expect(stored.enabled).toBe(true);
    expect(stored.message).toBe("Stock update in progress.");
    expect(stored.until).toBe(until);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "store_settings.maintenance_on" },
    });
    expect(audit).not.toBeNull();
  });

  it("brings it back up, and audits that separately", async () => {
    await saveMaintenanceAction({ enabled: true, message: null, until: null });
    const result = await saveMaintenanceAction({
      enabled: false,
      message: null,
      until: null,
    });
    expect(result).toEqual({ ok: true });
    expect((await getMaintenance()).enabled).toBe(false);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "store_settings.maintenance_off" },
    });
    expect(audit).not.toBeNull();
  });

  it("refuses an unparseable return time rather than promising customers a wrong one", async () => {
    const result = await saveMaintenanceAction({
      enabled: true,
      message: null,
      until: "whenever",
    });
    expect(result.ok).toBe(false);
  });

  it("refuses an over-long message", async () => {
    const result = await saveMaintenanceAction({
      enabled: true,
      message: "x".repeat(600),
      until: null,
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a non-admin — nobody else can take the shop offline", async () => {
    await saveMaintenanceAction({ enabled: false, message: null, until: null });
    viewerMock.current = { kind: "anon" };
    const result = await saveMaintenanceAction({
      enabled: true,
      message: null,
      until: null,
    });
    expect(result.ok).toBe(false);
    expect((await getMaintenance()).enabled).toBe(false);
  });
});
