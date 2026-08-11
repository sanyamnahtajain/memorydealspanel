"use client";

import * as React from "react";
import { cartLineSummariesAction } from "@/server/actions/cart";

/**
 * Client-side cart-lines store — powers the "In cart · N" chips on product
 * cards without re-rendering (or resetting) the listing.
 *
 * A module singleton keyed by `${productId}:${variantId}` holding the LINE
 * quantity, read through `useSyncExternalStore`. Primed once per session from
 * the server (only when the header count says the cart is non-empty), then
 * kept live by the add/update/remove flows calling `setCartLineQty` with the
 * server-confirmed quantity. Survives client navigations; no polling.
 */

type LineKey = string;

const lineQty = new Map<LineKey, number>();
let version = 0;
let primeStarted = false;
const listeners = new Set<() => void>();

function key(productId: string, variantId: string | null | undefined): LineKey {
  return `${productId}:${variantId ?? ""}`;
}

function emit(): void {
  version += 1;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getVersion(): number {
  return version;
}

/** Replace the whole store with the server's line summary (idempotent). */
export function primeCartLines(
  entries: { productId: string; variantId: string | null; quantity: number }[],
): void {
  lineQty.clear();
  for (const e of entries) lineQty.set(key(e.productId, e.variantId), e.quantity);
  emit();
}

/** Authoritative per-line update (server-confirmed qty; 0 removes). */
export function setCartLineQty(
  productId: string,
  variantId: string | null | undefined,
  quantity: number,
): void {
  const k = key(productId, variantId);
  if (quantity <= 0) lineQty.delete(k);
  else lineQty.set(k, quantity);
  emit();
}

/** Empty the store (cart cleared / order placed). */
export function clearCartLinesStore(): void {
  if (lineQty.size === 0) return;
  lineQty.clear();
  emit();
}

/** Fetch the summary ONCE per session (no-op on later calls). */
export function ensureCartLinesPrimed(): void {
  if (primeStarted) return;
  primeStarted = true;
  void cartLineSummariesAction()
    .then((res) => {
      if (res.ok) primeCartLines(res.lines);
    })
    .catch(() => {
      primeStarted = false; // transient failure — allow a later retry
    });
}

/** Total units of a product in the cart (summed across its variants). */
export function useProductInCartQty(productId: string): number {
  const v = React.useSyncExternalStore(subscribe, getVersion, getVersion);
  return React.useMemo(() => {
    void v; // re-derive on every store change
    let sum = 0;
    const prefix = `${productId}:`;
    for (const [k, qty] of lineQty) {
      if (k.startsWith(prefix)) sum += qty;
    }
    return sum;
  }, [productId, v]);
}
