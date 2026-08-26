"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";

import { resolveViewer } from "@/server/auth/viewer";
import { isCustomer, type CustomerViewer } from "@/server/types/viewer";
import { limit } from "@/server/security/ratelimit";
import {
  addToCart,
  updateQuantity,
  removeItem,
  clearCart,
  CartError,
  setCartRequirement,
} from "@/server/services/cart";
import {
  addToCartSchema,
  updateQuantitySchema,
  cartLineRefSchema,
} from "@/lib/schemas/cart";
import {
  perModelRules,
  resolveEffectiveAllocation,
  validatePerModelQuantities,
} from "@/lib/allocation";

/**
 * Cart server actions — the transport seam between the storefront and the
 * per-customer cart service.
 *
 * SECURITY (non-negotiable):
 *  - The customer id is taken EXCLUSIVELY from `resolveViewer()`. No action
 *    accepts a customerId from the client, so a caller can only ever mutate
 *    their OWN cart (IDOR-proof by construction).
 *  - EVERY mutation re-verifies price access (APPROVED + live unexpired grant)
 *    via `requireApprovedCustomer` → the service's `assertApproved`. A pending/
 *    expired/blocked/anonymous viewer gets a typed `{ ok: false, reason }` so
 *    the client can route to login / request-access instead of failing blind.
 *  - The client sends ONLY { productId, variantId?, quantity }. Any price in
 *    the payload is not part of the schema and is dropped — the server computes
 *    all money from the gated DAL.
 *  - Add/update are rate-limited per customer to blunt scripted abuse.
 *
 * A "use server" module may only export async functions — every schema/const is
 * module-internal.
 */

/** Why a cart action was refused, for client routing. */
export type CartActionReason =
  | "needs-login" // anonymous / not a customer → /account/login
  | "needs-approval" // pending/expired/blocked customer → request access
  | "invalid" // malformed input
  | "unavailable" // product/variant gone or out of stock
  | "breakdown" // per-model split missing/short — client re-opens the builder
  | "rate-limited" // too many requests
  | "error"; // unexpected server fault

export type CartActionResult =
  | { ok: true; quantity: number; itemCount: number; lineCount: number; clamped: boolean }
  | {
      ok: false;
      reason: CartActionReason;
      message: string;
      /** BREAKDOWN_SUM_MISMATCH context: the total the split must reach. */
      requiredTotal?: number;
    };

/** Rate limits (per customer). Generous for add, present to bound scripting. */
const ADD_LIMIT = { points: 30, window: 60 } as const; // 30/min
const UPDATE_LIMIT = { points: 60, window: 60 } as const; // 60/min

function revalidateCart(): void {
  // The cart page + any priced storefront surface that shows cart affordances.
  revalidatePath("/account/cart");
}

/**
 * Resolve the current viewer and require a price-authorised customer. Returns
 * the narrowed CustomerViewer on success, or a typed refusal the caller returns
 * verbatim. This is the single approval gate for every mutating action.
 */
async function requireApprovedCustomer(): Promise<
  | { ok: true; viewer: CustomerViewer }
  | { ok: false; result: CartActionResult }
> {
  const viewer = await resolveViewer();
  if (!isCustomer(viewer)) {
    return {
      ok: false,
      result: {
        ok: false,
        reason: "needs-login",
        message: "Please sign in to use your cart.",
      },
    };
  }
  if (!viewer.priceAccess || viewer.status !== "APPROVED") {
    return {
      ok: false,
      result: {
        ok: false,
        reason: "needs-approval",
        message: "Your account must be approved to place orders.",
      },
    };
  }
  return { ok: true, viewer };
}

/**
 * Per-model pack/minimum rules for a breakdown (the ONE piece of allocation
 * validation the service layer doesn't cover — its `settleBreakdownTotal`
 * checks only the TOTAL). Validating the INPUT split alone is sufficient even
 * though the service merges adds into an existing line: multiples sum to
 * multiples and per-model totals only grow. Returns a typed refusal, or null
 * to proceed. Non-allocation products pass through untouched (the service
 * ignores stray breakdowns).
 */
async function perModelBreakdownRefusal(data: {
  productId: string;
  variantId?: string;
  breakdown?: (
    | { modelId: string; qty: number }
    | { custom: true; name: string; qty: number }
  )[];
}): Promise<CartActionResult | null> {
  const breakdown = data.breakdown;
  if (!breakdown || breakdown.length === 0) return null;

  const product = await prisma.product.findUnique({
    where: { id: data.productId },
    select: {
      packMultiple: true,
      allocation: true,
      category: { select: { defaultAllocation: true } },
    },
  });
  if (!product) return null; // the service refuses with the proper error

  const allocation = resolveEffectiveAllocation(
    product.allocation,
    product.category?.defaultAllocation,
  );
  if (!allocation?.required) return null;

  let packMultiple = product.packMultiple;
  if (data.variantId) {
    // Mirror the service's resolveUnit: variant pack overrides the product's.
    const variant = await prisma.productVariant.findFirst({
      where: { id: data.variantId, productId: data.productId },
      select: { packMultiple: true },
    });
    packMultiple = variant?.packMultiple ?? product.packMultiple;
  }

  const rules = perModelRules(allocation.minPerModel, packMultiple);
  if (rules.pack === 1 && rules.min <= 1) return null; // nothing to enforce

  // Custom (typed) lines carry their own name; only master rows need lookup.
  const masterIds = breakdown.flatMap((e) =>
    "modelId" in e ? [e.modelId] : [],
  );
  const models = masterIds.length
    ? await prisma.deviceModel.findMany({
        where: { id: { in: masterIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(models.map((m) => [m.id, m.name]));
  const issues = validatePerModelQuantities(
    breakdown.map((e) =>
      "modelId" in e
        ? { modelId: e.modelId, qty: e.qty, name: nameById.get(e.modelId) }
        : { qty: e.qty, name: e.name },
    ),
    rules,
  );
  if (issues.length === 0) return null;
  return { ok: false, reason: "breakdown", message: issues[0].message };
}

/** Map a service CartError code onto a client-facing refusal reason. */
function reasonForCartError(error: CartError): CartActionReason {
  switch (error.code) {
    case "NOT_APPROVED":
      return "needs-approval";
    case "PRODUCT_UNAVAILABLE":
    case "VARIANT_UNAVAILABLE":
    case "OUT_OF_STOCK":
      return "unavailable";
    case "BREAKDOWN_REQUIRED":
    case "BREAKDOWN_INVALID":
    case "BREAKDOWN_SUM_MISMATCH":
      return "breakdown";
    case "LINE_LIMIT":
    case "NOT_IN_CART":
      return "invalid";
    default:
      return "error";
  }
}

/**
 * Add a product (optionally a variant) to the current customer's cart, or
 * increment the existing line. Only an APPROVED customer may add.
 */
export async function addToCartAction(input: unknown): Promise<CartActionResult> {
  const gate = await requireApprovedCustomer();
  if (!gate.ok) return gate.result;
  const { viewer } = gate;

  const parsed = addToCartSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid",
      message: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  const rl = await limit(viewer.customerId, ADD_LIMIT, "cart-add");
  if (!rl.ok) {
    return {
      ok: false,
      reason: "rate-limited",
      message: "You're adding to cart too quickly. Please wait a moment.",
    };
  }

  const refusal = await perModelBreakdownRefusal(parsed.data);
  if (refusal) return refusal;

  try {
    const result = await addToCart(viewer, parsed.data);
    revalidateCart();
    return { ok: true, ...result };
  } catch (error) {
    return handleMutationError(error, "add");
  }
}

/**
 * Set the exact quantity of a line (from the cart stepper). Only an APPROVED
 * customer may update.
 */
export async function updateCartQuantityAction(
  input: unknown,
): Promise<CartActionResult> {
  const gate = await requireApprovedCustomer();
  if (!gate.ok) return gate.result;
  const { viewer } = gate;

  const parsed = updateQuantitySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid",
      message: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  const rl = await limit(viewer.customerId, UPDATE_LIMIT, "cart-update");
  if (!rl.ok) {
    return {
      ok: false,
      reason: "rate-limited",
      message: "Too many changes too quickly. Please wait a moment.",
    };
  }

  const refusal = await perModelBreakdownRefusal(parsed.data);
  if (refusal) return refusal;

  try {
    const result = await updateQuantity(viewer, parsed.data);
    revalidateCart();
    return { ok: true, ...result };
  } catch (error) {
    return handleMutationError(error, "update");
  }
}

/**
 * Remove a single line from the current customer's cart. Allowed for any
 * logged-in customer (even a lapsed one may prune a frozen cart). Idempotent.
 */
export async function removeCartItemAction(
  input: unknown,
): Promise<CartActionResult> {
  const viewer = await resolveViewer();
  if (!isCustomer(viewer)) {
    return {
      ok: false,
      reason: "needs-login",
      message: "Please sign in to use your cart.",
    };
  }

  const parsed = cartLineRefSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid",
      message: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  try {
    const { itemCount, lineCount } = await removeItem(viewer.customerId, parsed.data);
    revalidateCart();
    return { ok: true, quantity: 0, itemCount, lineCount, clamped: false };
  } catch (error) {
    return handleMutationError(error, "remove");
  }
}

/**
 * Empty the current customer's cart. Allowed for any logged-in customer.
 * Idempotent.
 */
export async function clearCartAction(): Promise<CartActionResult> {
  const viewer = await resolveViewer();
  if (!isCustomer(viewer)) {
    return {
      ok: false,
      reason: "needs-login",
      message: "Please sign in to use your cart.",
    };
  }

  try {
    await clearCart(viewer.customerId);
    revalidateCart();
    return { ok: true, quantity: 0, itemCount: 0, lineCount: 0, clamped: false };
  } catch (error) {
    return handleMutationError(error, "clear");
  }
}

/** Translate a thrown error into a typed refusal, logging the unexpected ones. */
function handleMutationError(error: unknown, op: string): CartActionResult {
  if (error instanceof CartError) {
    return {
      ok: false,
      reason: reasonForCartError(error),
      message: error.message,
      ...(error.details?.requiredTotal !== undefined
        ? { requiredTotal: error.details.requiredTotal }
        : {}),
    };
  }
  console.error(`[actions/cart] ${op} failed:`, error);
  return {
    ok: false,
    reason: "error",
    message: "Could not update your cart. Please try again.",
  };
}

/**
 * Save a line's requirement note + photos (customer). Thin wrapper over
 * `setCartRequirement`; the service enforces the product flag + URL prefix.
 */
export async function setCartRequirementAction(input: {
  productId: string;
  variantId?: string | null;
  note?: string;
  attachments?: { url: string }[];
}): Promise<
  | { ok: true; note: string | null; attachments: { url: string }[] }
  | { ok: false; message: string }
> {
  const gate = await requireApprovedCustomer();
  if (!gate.ok) return { ok: false, message: gate.result.ok === false ? gate.result.message : "Not allowed." };
  const result = await setCartRequirement(gate.viewer, input);
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.reason === "not-in-cart"
          ? "Add the product to your cart first."
          : "This product doesn't accept requirement notes.",
    };
  }
  return result;
}

/**
 * Line summary for the storefront "In cart" chips: (productId, variantId,
 * quantity) only — NO prices. Anon/gated viewers get ok:false (chips hidden).
 */
export async function cartLineSummariesAction(): Promise<
  | { ok: true; lines: { productId: string; variantId: string | null; quantity: number }[] }
  | { ok: false }
> {
  const viewer = await resolveViewer();
  if (!isCustomer(viewer)) return { ok: false };
  const rows = await prisma.cartItem.findMany({
    where: { customerId: viewer.customerId },
    select: { productId: true, variantId: true, quantity: true },
    take: 200,
  });
  return {
    ok: true,
    lines: rows.map((r) => ({
      productId: r.productId,
      variantId: r.variantId ?? null,
      quantity: r.quantity,
    })),
  };
}
