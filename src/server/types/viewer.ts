import type { CustomerStatus } from "@/lib/schemas/shared";

/**
 * ViewerContext is computed once per request (middleware/session lookup)
 * and threaded through the DAL. It is THE price gate: price fields are
 * only ever selected/serialized when `canSeePrices(viewer)` is true.
 */
export interface AnonViewer {
  kind: "anon";
}

export interface CustomerViewer {
  kind: "customer";
  customerId: string;
  /**
   * True only when status is APPROVED and there is an active, unexpired,
   * unrevoked AccessGrant. Computed at session resolution — never trust
   * a client-supplied value.
   */
  priceAccess: boolean;
  status: CustomerStatus;
}

export interface AdminViewer {
  kind: "admin";
  adminId: string;
}

export type ViewerContext = AnonViewer | CustomerViewer | AdminViewer;

/** Singleton for unauthenticated requests. */
export const ANON_VIEWER: AnonViewer = Object.freeze({ kind: "anon" });

export function isAnon(viewer: ViewerContext): viewer is AnonViewer {
  return viewer.kind === "anon";
}

export function isCustomer(viewer: ViewerContext): viewer is CustomerViewer {
  return viewer.kind === "customer";
}

export function isAdmin(viewer: ViewerContext): viewer is AdminViewer {
  return viewer.kind === "admin";
}

/**
 * The single price-gate predicate. Admins always see prices; customers
 * only with an APPROVED status AND a live access grant. Belt-and-braces:
 * both conditions are required even though priceAccess implies approval.
 */
export function canSeePrices(viewer: ViewerContext): boolean {
  if (viewer.kind === "admin") {
    return true;
  }
  return (
    viewer.kind === "customer" &&
    viewer.priceAccess &&
    viewer.status === "APPROVED"
  );
}
