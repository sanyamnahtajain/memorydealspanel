import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import {
  getCartNotice,
  updateCartNotice,
  InvalidCartNoticeError,
  MAX_CART_NOTICE_CHARS,
} from "./store-settings";

/**
 * Cart-notice settings against the local test DB. The owner uses this copy
 * for GST billing terms, so the contract that matters: what the admin saves
 * is exactly what the cart shows, and empty means hidden.
 */

afterAll(async () => {
  await prisma.storeSettings.updateMany({ data: { cartNotice: null } });
});

describe("cart notice", () => {
  it("round-trips the owner's copy verbatim (incl. line breaks)", async () => {
    const copy =
      "ERD Portronics Digitek Ambrane Zebronics prices are with GST bill\n" +
      "Rest all prices are without bill — if you need a GST bill please " +
      "contact us in your WhatsApp group";
    await updateCartNotice(copy);
    expect(await getCartNotice()).toBe(copy);
  });

  it("trims, and clears on empty/whitespace", async () => {
    await updateCartNotice("  spaced  ");
    expect(await getCartNotice()).toBe("spaced");
    await updateCartNotice("   ");
    expect(await getCartNotice()).toBeNull();
    await updateCartNotice(null);
    expect(await getCartNotice()).toBeNull();
  });

  it("rejects copy over the cap instead of truncating it silently", async () => {
    await expect(
      updateCartNotice("x".repeat(MAX_CART_NOTICE_CHARS + 1)),
    ).rejects.toBeInstanceOf(InvalidCartNoticeError);
  });
});
