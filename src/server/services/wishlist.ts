import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import {
  toPricedProduct,
  toPublicProduct,
  type PublicProduct,
} from "@/server/dto/product";
import {
  canSeePrices,
  isCustomer,
  type CustomerViewer,
  type ViewerContext,
} from "@/server/types/viewer";

/**
 * Wishlist service — the saved-products list for a single customer.
 *
 * INVARIANT (IDOR): every function is scoped to the `customerId` argument and
 * queries `WishlistItem` with that id in the `where`. There is no code path that
 * reads or mutates a wishlist item without matching `customerId`, so one
 * customer can never touch another's list. The actions layer supplies the id
 * exclusively from `resolveViewer()` — never from client input.
 *
 * PRICE GATE: `listWishlist` returns the saved products through the same gated
 * mapper as the product DAL. A real price is only ever attached when
 * `canSeePrices(viewer)` is true; every other viewer gets a `PublicProduct`
 * (no money fields structurally present). Wishlisting itself is allowed for any
 * authenticated customer (even PENDING) so they can build a list while waiting
 * for approval, but that never unlocks a price.
 */

/** Product fields selected for a saved-list card — the PUBLIC allow-list. */
const PUBLIC_PRODUCT_SELECT = {
  id: true,
  categoryId: true,
  name: true,
  slug: true,
  sku: true,
  brand: true,
  brandRef: { select: { id: true, name: true, slug: true } },
  description: true,
  specs: true,
  moq: true,
  stockStatus: true,
  status: true,
  tags: true,
  images: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

/** PUBLIC allow-list plus money — only ever used for price-authorised viewers. */
const PRICED_PRODUCT_SELECT = {
  ...PUBLIC_PRODUCT_SELECT,
  price: true,
  mrp: true,
} satisfies Prisma.ProductSelect;

/** A saved product plus its wishlist metadata (when it was saved, any note). */
export interface WishlistEntry<TProduct extends PublicProduct = PublicProduct> {
  /** The saved product, gated to the viewer (priced only when approved). */
  product: TProduct;
  /** When the customer added this product. */
  savedAt: Date;
  /** Optional per-customer note attached at save time. */
  note: string | null;
}

/** Raised when a product cannot be wishlisted (missing or not purchasable). */
export class WishlistProductError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WishlistProductError";
  }
}

/**
 * Assert the product exists and is on the storefront (ACTIVE, not soft-deleted).
 * Returns the product id. A customer must not be able to wishlist a hidden or
 * deleted product, so we validate before writing.
 */
async function assertWishlistableProduct(productId: string): Promise<void> {
  const product = await prisma.product.findFirst({
    where: { id: productId, status: "ACTIVE", deletedAt: null },
    select: { id: true },
  });
  if (!product) {
    throw new WishlistProductError("Product is not available.");
  }
}

/**
 * Add a product to the customer's wishlist. Idempotent: a repeat add for the
 * same (customer, product) is a no-op thanks to the unique constraint, so the
 * heart never errors on a double-tap. Validates the product first.
 *
 * @returns `true` when a new row was created, `false` when it already existed.
 */
export async function addToWishlist(
  customerId: string,
  productId: string,
): Promise<boolean> {
  await assertWishlistableProduct(productId);
  try {
    await prisma.wishlistItem.create({
      data: { customerId, productId },
      select: { id: true },
    });
    return true;
  } catch (error) {
    // Unique-constraint violation ⇒ already saved. Idempotent success.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return false;
    }
    throw error;
  }
}

/**
 * Remove a product from the customer's wishlist. Scoped to `customerId`, so it
 * can only ever delete the current customer's own row. Idempotent: removing a
 * product that isn't saved is a no-op.
 *
 * @returns `true` when a row was deleted, `false` when nothing matched.
 */
export async function removeFromWishlist(
  customerId: string,
  productId: string,
): Promise<boolean> {
  const result = await prisma.wishlistItem.deleteMany({
    where: { customerId, productId },
  });
  return result.count > 0;
}

/**
 * Toggle a product in the customer's wishlist and report the resulting state.
 * `saved: true` means the product is now in the list; `false` means removed.
 */
export async function toggleWishlist(
  customerId: string,
  productId: string,
): Promise<{ saved: boolean }> {
  const removed = await removeFromWishlist(customerId, productId);
  if (removed) {
    return { saved: false };
  }
  await addToWishlist(customerId, productId);
  return { saved: true };
}

/**
 * List the customer's saved products, gated to the viewer.
 *
 * The `viewer` MUST be the customer whose `customerId` is passed (the actions
 * layer guarantees this). Products are returned newest-saved first. Prices are
 * attached ONLY when `canSeePrices(viewer)` — otherwise the entries carry a
 * `PublicProduct` with no money fields, and the projection omits price/mrp so
 * the value never even enters Node.
 *
 * Soft-deleted / de-activated products that a customer once saved are filtered
 * out (a stale save should not surface a gone product).
 */
export async function listWishlist(
  viewer: CustomerViewer,
): Promise<WishlistEntry[]> {
  const priced = canSeePrices(viewer);
  const items = await prisma.wishlistItem.findMany({
    where: {
      customerId: viewer.customerId,
      product: { status: "ACTIVE", deletedAt: null },
    },
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      note: true,
      product: {
        select: priced ? PRICED_PRODUCT_SELECT : PUBLIC_PRODUCT_SELECT,
      },
    },
  });

  return items.map((item) => ({
    product: priced
      ? toPricedProduct(item.product as Parameters<typeof toPricedProduct>[0])
      : toPublicProduct(item.product),
    savedAt: item.createdAt,
    note: item.note ?? null,
  }));
}

/**
 * The set of product ids the customer has saved — used to hydrate the initial
 * fill state of every heart on a listing without N per-card round trips.
 */
export async function wishlistProductIds(
  customerId: string,
): Promise<Set<string>> {
  const items = await prisma.wishlistItem.findMany({
    where: { customerId },
    select: { productId: true },
  });
  return new Set(items.map((item) => item.productId));
}

/** How many products the customer has saved (for the header/tab badge). */
export async function wishlistCount(customerId: string): Promise<number> {
  return prisma.wishlistItem.count({ where: { customerId } });
}

/**
 * Wishlist state a storefront page needs to hydrate its shell + heart controls:
 * the saved `count` (header/tab badge) and the `savedProductIds` set (to seed
 * each HeartButton's filled state without a per-card round trip).
 *
 * Resolved directly from the viewer so callers don't repeat the `isCustomer`
 * guard. For a non-customer viewer (anon or admin — neither has a personal
 * wishlist) this returns a zero count and an empty set: the header heart links
 * to the wishlist page (which itself gates on login) and every product heart
 * paints empty, prompting login on tap. Carries NO price — only this customer's
 * own product ids and a count.
 */
export async function wishlistStateForViewer(
  viewer: ViewerContext,
): Promise<{ count: number; savedProductIds: Set<string> }> {
  if (!isCustomer(viewer)) {
    return { count: 0, savedProductIds: new Set<string>() };
  }
  const savedProductIds = await wishlistProductIds(viewer.customerId);
  return { count: savedProductIds.size, savedProductIds };
}
