import {
  canSeePrices,
  isAdmin,
  type AdminViewer,
  type ViewerContext,
} from "@/server/types/viewer";

/**
 * Thrown when a viewer attempts an operation their context does not permit.
 * A typed error (rather than a bare `Error`) so that API/route boundaries can
 * `instanceof`-check it and map it to an HTTP 403 without string matching.
 */
export class ForbiddenError extends Error {
  /** Stable discriminator for cross-boundary checks and serialization. */
  readonly code = "FORBIDDEN" as const;

  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
    // Restore prototype chain for `instanceof` under transpiled targets.
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}

/** Type guard usable by boundaries that only import from the DAL. */
export function isForbiddenError(error: unknown): error is ForbiddenError {
  return error instanceof ForbiddenError;
}

/**
 * Narrows `viewer` to an `AdminViewer` or throws `ForbiddenError`. Use to
 * gate admin-only DAL reads (e.g. the DealSheet grid) so a non-admin caller
 * cannot obtain admin-shaped data even by passing the wrong context.
 */
export function assertAdmin(viewer: ViewerContext): asserts viewer is AdminViewer {
  if (!isAdmin(viewer)) {
    throw new ForbiddenError("Admin access required");
  }
}

/**
 * Throws `ForbiddenError` unless the viewer is authorised to see prices.
 * This mirrors the `canSeePrices` predicate that the DAL uses to choose its
 * return shape, but as an assertion for callers that must have pricing.
 */
export function assertPriceAccess(viewer: ViewerContext): void {
  if (!canSeePrices(viewer)) {
    throw new ForbiddenError("Price access required");
  }
}
