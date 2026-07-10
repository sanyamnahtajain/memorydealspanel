import { describe, it, expect, vi, beforeEach } from "vitest";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import {
  viewerHasPermission,
  type AdminViewer,
  type AnonViewer,
  type CustomerViewer,
} from "@/server/types/viewer";

/**
 * Unit tests for RBAC enforcement helpers.
 *
 * `permissions.ts` imports `server-only` and pulls in `getViewer` (Prisma) via
 * the page guard. We stub both so this stays a pure logic test with no DB or
 * RSC dependency; `requirePermissionPage`'s redirect wiring is covered by
 * mocking `next/navigation` + the resolved viewer.
 */

vi.mock("server-only", () => ({}));

const redirect = vi.fn((): never => {
  throw new Error("REDIRECT");
});
vi.mock("next/navigation", () => ({ redirect }));

const getViewer = vi.fn();
vi.mock("@/server/auth/viewer", () => ({ getViewer }));

// Import AFTER mocks are registered.
const { assertPermission, can, requirePermissionPage, ForbiddenError } =
  await import("./permissions");

function adminWith(permissions: string[]): AdminViewer {
  return {
    kind: "admin",
    adminId: "admin_1",
    name: "Test Admin",
    roleId: "role_1",
    permissions,
  };
}

const OWNER = adminWith(["*"]);
const CATALOG = adminWith([PERMISSIONS.PRODUCTS_VIEW, PERMISSIONS.PRODUCTS_EDIT]);
const NO_ROLE: AdminViewer = {
  kind: "admin",
  adminId: "admin_2",
  name: "No Role",
  roleId: null,
  permissions: [],
};
const ANON: AnonViewer = { kind: "anon" };
const CUSTOMER: CustomerViewer = {
  kind: "customer",
  customerId: "cust_1",
  priceAccess: true,
  status: "APPROVED",
};

beforeEach(() => {
  redirect.mockClear();
  getViewer.mockReset();
});

describe("hasPermission wildcard vs specific", () => {
  it("the Owner wildcard grants every permission", () => {
    for (const key of Object.values(PERMISSIONS)) {
      expect(hasPermission(["*"], key)).toBe(true);
    }
  });

  it("a specific grant only matches that exact key", () => {
    const granted = [PERMISSIONS.PRODUCTS_VIEW];
    expect(hasPermission(granted, PERMISSIONS.PRODUCTS_VIEW)).toBe(true);
    expect(hasPermission(granted, PERMISSIONS.PRODUCTS_EDIT)).toBe(false);
    expect(hasPermission(granted, PERMISSIONS.USERS_MANAGE)).toBe(false);
  });

  it("an empty grant matches nothing", () => {
    expect(hasPermission([], PERMISSIONS.DASHBOARD_VIEW)).toBe(false);
  });
});

describe("viewerHasPermission", () => {
  it("Owner admin holds any permission", () => {
    expect(viewerHasPermission(OWNER, PERMISSIONS.SETTINGS_MANAGE)).toBe(true);
  });

  it("scoped admin holds only its keys", () => {
    expect(viewerHasPermission(CATALOG, PERMISSIONS.PRODUCTS_EDIT)).toBe(true);
    expect(viewerHasPermission(CATALOG, PERMISSIONS.PRODUCTS_DELETE)).toBe(
      false,
    );
  });

  it("admin with no role holds nothing", () => {
    expect(viewerHasPermission(NO_ROLE, PERMISSIONS.PRODUCTS_VIEW)).toBe(false);
  });

  it("anon and customer viewers never hold permissions", () => {
    expect(viewerHasPermission(ANON, PERMISSIONS.PRODUCTS_VIEW)).toBe(false);
    expect(viewerHasPermission(CUSTOMER, PERMISSIONS.PRODUCTS_VIEW)).toBe(false);
  });
});

describe("can", () => {
  it("mirrors viewerHasPermission as a plain boolean", () => {
    expect(can(OWNER, PERMISSIONS.ROLES_MANAGE)).toBe(true);
    expect(can(CATALOG, PERMISSIONS.ROLES_MANAGE)).toBe(false);
    expect(can(ANON, PERMISSIONS.ROLES_MANAGE)).toBe(false);
  });
});

describe("assertPermission", () => {
  it("returns void when the permission is held", () => {
    expect(() =>
      assertPermission(OWNER, PERMISSIONS.USERS_MANAGE),
    ).not.toThrow();
    expect(() =>
      assertPermission(CATALOG, PERMISSIONS.PRODUCTS_VIEW),
    ).not.toThrow();
  });

  it("throws ForbiddenError carrying the missing permission", () => {
    try {
      assertPermission(CATALOG, PERMISSIONS.USERS_MANAGE);
      throw new Error("expected assertPermission to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as InstanceType<typeof ForbiddenError>).permission).toBe(
        PERMISSIONS.USERS_MANAGE,
      );
      expect((err as InstanceType<typeof ForbiddenError>).name).toBe(
        "ForbiddenError",
      );
    }
  });

  it("throws for anon viewers", () => {
    expect(() =>
      assertPermission(ANON, PERMISSIONS.DASHBOARD_VIEW),
    ).toThrow(ForbiddenError);
  });
});

describe("requirePermissionPage", () => {
  it("returns the narrowed admin viewer when the permission is held", async () => {
    getViewer.mockResolvedValue(OWNER);
    const viewer = await requirePermissionPage(PERMISSIONS.SETTINGS_MANAGE);
    expect(viewer).toBe(OWNER);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects to /admin/login when the admin lacks the permission", async () => {
    getViewer.mockResolvedValue(CATALOG);
    await expect(
      requirePermissionPage(PERMISSIONS.USERS_MANAGE),
    ).rejects.toThrow("REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/admin/login");
  });

  it("redirects to /admin/login for a non-admin viewer", async () => {
    getViewer.mockResolvedValue(ANON);
    await expect(
      requirePermissionPage(PERMISSIONS.DASHBOARD_VIEW),
    ).rejects.toThrow("REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/admin/login");
  });
});
