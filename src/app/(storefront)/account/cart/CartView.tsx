"use client";

/**
 * CartView — the interactive cart (client component).
 *
 * SECURITY / GATE:
 *  - The customer id NEVER appears here; every mutation goes through a server
 *    action that resolves the viewer from the session. This component only ever
 *    sends { productId, variantId?, quantity } — NO price. Line prices come
 *    pre-computed from the server (each line's `unitPricePaise`), and are only
 *    present when the viewer is price-authorised (`priced`).
 *  - When access has lapsed (`canOrder` false) every mutating control and the
 *    Place-order button are disabled — the cart freezes read-only.
 *
 * UX (§0): optimistic quantity steppers + optimistic remove, per-line warnings
 * (out-of-stock / below-MOQ / unavailable / variant-removed / low-stock), a
 * sticky mobile summary bar, reduced-motion aware transitions, and a length-
 * capped plain-text note. On successful placement it routes to the confirmation
 * page with the (random) order number.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, ShoppingBag, Lock, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { formatPaise } from "@/lib/money";
import { MAX_CART_NOTE_LENGTH, MAX_QTY_PER_LINE } from "@/lib/schemas/cart";
import { Button } from "@/components/ui/button";
import { CartLineRow } from "@/components/storefront/cart/CartLineRow";
import { DeliveryNotice } from "@/components/storefront/orders/DeliveryNotice";
import {
  DELIVERY_MINIMUM_CAVEAT,
  deliveryDisclosureCopy,
  type DeliveryDisclosure,
} from "@/lib/delivery";
import {
  gstDisclosureLabel,
  movLineText,
  noteDisclosureLabel,
} from "./summary-copy";
import { BucketCard } from "@/components/storefront/billing/BucketCard";
import {
  closestNextTier,
  formatBps,
  rebucket,
  shouldRenderBuckets,
  type GroupRules,
} from "@/components/storefront/billing/bucket-math";
import {
  updateCartQuantityAction,
  removeCartItemAction,
} from "@/server/actions/cart";
import { placeOrderAction } from "@/server/actions/orders";
import {
  previewCouponAction,
  suggestCouponsAction,
  type CouponSuggestionDTO,
} from "@/server/actions/coupons";
import type { CartLineIssue, CartTaxSummary } from "@/server/services/cart";
import type { StockStatus } from "@/lib/schemas/shared";
import type { Bucket, BucketedCart } from "@/lib/billing-groups/types";

/**
 * Client-side mirror of the server's integer GST line math (src/lib/gst.ts).
 * Kept in lock-step so the preview stays live + correct across optimistic
 * quantity changes; the server re-derives + freezes the authoritative figures
 * at placement, so this is display-only and can never be trusted for money.
 */
function lineTaxOf(
  lineTotalPaise: number,
  gstRateBps: number,
  taxInclusive: boolean,
): { taxablePaise: number; taxPaise: number; grossPaise: number } {
  if (gstRateBps === 0) {
    return { taxablePaise: lineTotalPaise, taxPaise: 0, grossPaise: lineTotalPaise };
  }
  if (taxInclusive) {
    const taxablePaise = Math.round((lineTotalPaise * 10000) / (10000 + gstRateBps));
    return {
      taxablePaise,
      taxPaise: lineTotalPaise - taxablePaise,
      grossPaise: lineTotalPaise,
    };
  }
  const taxPaise = Math.round((lineTotalPaise * gstRateBps) / 10000);
  return { taxablePaise: lineTotalPaise, taxPaise, grossPaise: lineTotalPaise + taxPaise };
}

/** Client-safe shape of one cart line (built server-side; price already gated). */
export interface CartLineData {
  productId: string;
  variantId: string | null;
  name: string;
  sku: string;
  /** Product slug for the detail link; null when the product has vanished. */
  slug: string | null;
  brand: string | null;
  variantLabel: string | null;
  imageUrl: string | null;
  quantity: number;
  moq: number;
  /** Pack multiple for the line (1 = none) — the stepper's step size. */
  packMultiple: number;
  /** Per-line ceiling (admin-set, default 200). */
  maxQty: number;
  /** Whether this product requires a per-model split (hides the stepper). */
  allocationRequired: boolean;
  /**
   * Per-model minimum from the allocation config, or null. Display only — it
   * lets the split editor flag violations inline, exactly as the server will.
   */
  minPerModel: number | null;
  /**
   * Resolved split for display/edit, when the line carries one. `modelId` is
   * null (with `custom` true) for a model the buyer typed because the master
   * list lacked it.
   */
  breakdown: {
    modelId: string | null;
    custom?: boolean;
    name: string;
    qty: number;
  }[] | null;
  /** Whether this product accepts a requirement note + photos. */
  allowRequirementNotes: boolean;
  /** Stored requirement note, when set. */
  note: string | null;
  /** Stored requirement photos ([{url}], our storage only). */
  attachments: { url: string }[];
  stockStatus: StockStatus;
  /** Unit price in paise, or null when the viewer is gated. */
  unitPricePaise: number | null;
  lineTotalPaise: number | null;
  available: boolean;
  issues: CartLineIssue[];
  /**
   * Effective GST rate in basis points for this line, or null when GST is off
   * (kill-switch) / the line has no rate. NON-MONETARY — drives the live preview.
   */
  gstRateBps: number | null;
  /** Whether the displayed line total already includes the GST above. */
  taxInclusive: boolean;
}

export interface CartViewProps {
  /** Delivery minimum-charge disclosure (owner request) — shown to ALL. */
  deliveryDisclosure?: DeliveryDisclosure | null;
  /** Owner's free-text billing notice under the summary (null = hidden). */
  cartNotice?: string | null;
  /**
   * The delivery charge ADDED to the cart total, in paise (0 when delivery is
   * off). A store-wide charge rather than a catalog price, so it is shown to
   * every viewer — but it only joins the payable total for a PRICED one.
   * Added LAST: after the bucket discounts and after the coupon, so neither
   * can ever discount it.
   */
  deliveryChargePaise?: number;
  initialLines: CartLineData[];
  initialSubtotalPaise: number | null;
  priced: boolean;
  /** Whether the viewer may still place an order (approved + live grant). */
  canOrder: boolean;
  /**
   * The server's GST order-preview, or null when GST is off / the viewer is
   * gated. The client keeps supplyType + seller-state context from this and
   * re-derives the amounts live as quantities change.
   */
  initialTax: CartTaxSummary | null;
  /**
   * The configurable minimum order value in paise, or null when off — passed
   * only for a PRICED viewer (an amount must never reach a gated page). The
   * server re-checks at placement; this only drives the shortfall UI.
   */
  minOrderValuePaise?: number | null;
  /**
   * The server's billing-group split of the ORDERABLE lines (buckets, tiered
   * discounts, "add ₹X more" hints), or null when gated / not priced. The
   * client keeps membership from this and re-derives the amounts live.
   */
  initialBilling?: BucketedCart | null;
  /** Each active group's tiers (ids + tiers only) so the live mirror can re-run them. */
  groupRules?: GroupRules[];
}

/**
 * A stable per-line key (product + variant pair is unique in a cart). Same
 * shape as `lineKey` in src/lib/billing-groups/snapshot.ts, which is what the
 * server keys `Bucket.lines[].key` with.
 */
function lineKey(l: { productId: string; variantId: string | null }): string {
  return `${l.productId}:${l.variantId ?? ""}`;
}

export function CartView({
  initialLines,
  initialSubtotalPaise,
  minOrderValuePaise = null,
  deliveryDisclosure = null,
  cartNotice = null,
  deliveryChargePaise = 0,
  priced,
  canOrder,
  initialTax,
  initialBilling = null,
  groupRules = [],
}: CartViewProps) {
  const router = useRouter();
  const reduced = useReducedMotion();

  const [lines, setLines] = React.useState<CartLineData[]>(initialLines);
  const [pending, setPending] = React.useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = React.useState("");
  const [placing, setPlacing] = React.useState(false);
  // Applied coupon (server-previewed). Re-validated + atomically redeemed at
  // placement — this only drives the summary display.
  const [coupon, setCoupon] = React.useState<{ code: string; discountPaise: number } | null>(null);
  const [couponBusy, setCouponBusy] = React.useState(false);
  // Stable idempotency key for THIS cart session — a double-click reuses it, so
  // the server dedups instead of creating a second order. Generated in an effect
  // (impure APIs must not run during render); guaranteed present before any user
  // click can fire placement.
  const idempotencyKeyRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (idempotencyKeyRef.current === null) {
      idempotencyKeyRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
  }, []);

  const orderableLines = lines.filter((l) => l.available);
  const subtotalPaise = priced
    ? orderableLines.reduce((sum, l) => sum + (l.lineTotalPaise ?? 0), 0)
    : null;
  const itemCount = orderableLines.reduce((sum, l) => sum + l.quantity, 0);

  // Live billing-group mirror: bucket membership from the server, amounts
  // re-derived from the CURRENT (possibly optimistic) line totals through the
  // same pure engine. Null when gated — then everything renders as before.
  const billing = React.useMemo<BucketedCart | null>(() => {
    if (!priced || !initialBilling) return null;
    return rebucket(
      initialBilling,
      lines.map((l) => ({
        key: lineKey(l),
        lineTotalPaise: l.lineTotalPaise,
        available: l.available,
      })),
      groupRules,
    );
  }, [priced, initialBilling, lines, groupRules]);
  const groupDiscountPaise = billing?.groupDiscountPaise ?? 0;
  // Per-line NET totals (after the bucket discount share) — the base the GST
  // mirror runs on, so tax is previewed on the discounted amount.
  const netByKey = React.useMemo(() => {
    const m = new Map<string, number>();
    if (!billing) return m;
    for (const b of billing.buckets) for (const l of b.lines) m.set(l.key, l.netPaise);
    return m;
  }, [billing]);

  // Minimum order value: the live shortfall (paise) still needed, or null when
  // the minimum is off / already met / the viewer is gated. Server-enforced at
  // placement — this only disables the button and explains why. Runs on the
  // DISCOUNTED subtotal (bucket discounts + coupon).
  const discountPaise = priced ? (coupon?.discountPaise ?? 0) : 0;
  const movShortfallPaise =
    minOrderValuePaise != null && subtotalPaise != null
      ? Math.max(0, minOrderValuePaise - (subtotalPaise - groupDiscountPaise - discountPaise)) ||
        null
      : null;
  const canPlace =
    canOrder && orderableLines.length > 0 && !placing && movShortfallPaise === null;

  // Live GST preview: re-derived from the current (possibly optimistic) line
  // quantities using the same integer formula as the server, then split by the
  // supply type the server determined. When GST is off (initialTax null) the
  // whole block is absent and the cart renders exactly as pre-GST. Lines feed
  // in NET of their bucket-discount share so tax previews on the discounted amount.
  const taxPreview = React.useMemo(() => {
    if (!priced || !initialTax) return null;
    let totalTaxablePaise = 0;
    let totalTaxPaise = 0;
    let grossPaise = 0;
    for (const l of orderableLines) {
      if (l.gstRateBps === null || l.lineTotalPaise === null) continue;
      const base = netByKey.get(lineKey(l)) ?? l.lineTotalPaise;
      const t = lineTaxOf(base, l.gstRateBps, l.taxInclusive);
      totalTaxablePaise += t.taxablePaise;
      totalTaxPaise += t.taxPaise;
      grossPaise += t.grossPaise;
    }
    const supplyType = initialTax.supplyType;
    // CGST/SGST split mirrors src/lib/gst.ts (odd paisa → SGST). IGST = full tax.
    const cgstPaise = supplyType === "INTRA" ? Math.floor(totalTaxPaise / 2) : 0;
    const sgstPaise = supplyType === "INTRA" ? totalTaxPaise - cgstPaise : 0;
    const igstPaise = supplyType === "INTER" ? totalTaxPaise : 0;
    // Preserve the server's rounding mode: INVOICE re-applies a nearest-rupee
    // round-off live; LINE leaves the summed gross exact.
    let roundOffPaise = 0;
    let grandTotalPaise = grossPaise;
    if (initialTax.roundingMode === "INVOICE") {
      grandTotalPaise = Math.round(grossPaise / 100) * 100;
      roundOffPaise = grandTotalPaise - grossPaise;
    }
    return {
      supplyType,
      totalTaxablePaise,
      totalTaxPaise,
      totalCgstPaise: cgstPaise,
      totalSgstPaise: sgstPaise,
      totalIgstPaise: igstPaise,
      roundOffPaise,
      grandTotalPaise,
      roundingMode: initialTax.roundingMode,
    } satisfies CartTaxSummary;
  }, [priced, initialTax, orderableLines, netByKey]);

  // The customer-facing total that "Place order" commits to: the GST grand
  // total (already on the bucket-discounted base) when GST applies, else
  // subtotal − bucket discounts; the coupon comes off after either. The
  // delivery charge is added LAST — it is a charge, not goods, so no discount
  // and no tax touches it (see src/lib/delivery.ts).
  const payablePaise =
    (taxPreview
      ? taxPreview.grandTotalPaise
      : (subtotalPaise ?? 0) - groupDiscountPaise) -
    discountPaise +
    deliveryChargePaise;

  // Nearest tier unlock across buckets — the one-line mobile nudge.
  const nudge = closestNextTier(billing);
  const renderBuckets = shouldRenderBuckets(billing);

  // Keep an applied coupon honest as quantities change: re-preview on any
  // subtotal move; a code that stops applying is dropped with a note.
  const appliedCode = coupon?.code ?? null;
  React.useEffect(() => {
    if (!appliedCode || subtotalPaise == null) return;
    let cancelled = false;
    void previewCouponAction(appliedCode).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setCoupon({ code: res.code, discountPaise: res.discountPaise });
      } else {
        setCoupon(null);
        toast.info(`Coupon ${appliedCode} removed — ${res.message}`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [appliedCode, subtotalPaise]);

  // Coupon suggestions, quoted server-side against the live cart. Re-fetched
  // when the subtotal moves so the applicable/blocked split stays honest.
  const [suggestions, setSuggestions] = React.useState<CouponSuggestionDTO[]>([]);
  React.useEffect(() => {
    if (!priced || !canOrder) return;
    let cancelled = false;
    void suggestCouponsAction().then((res) => {
      if (!cancelled && res.ok) setSuggestions(res.suggestions);
    });
    return () => {
      cancelled = true;
    };
  }, [priced, canOrder, subtotalPaise]);

  const applyCoupon = React.useCallback(async (raw: string) => {
    const code = raw.trim().toUpperCase();
    if (!code) return;
    setCouponBusy(true);
    try {
      const res = await previewCouponAction(code);
      if (res.ok) {
        setCoupon({ code: res.code, discountPaise: res.discountPaise });
        toast.success(`Coupon ${res.code} applied — ${formatPaise(res.discountPaise)} off.`);
      } else {
        toast.error(res.message);
      }
    } finally {
      setCouponBusy(false);
    }
  }, []);

  const markPending = (key: string, on: boolean) =>
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const changeQuantity = React.useCallback(
    async (line: CartLineData, nextQty: number) => {
      const key = lineKey(line);
      if (nextQty < 1 || nextQty > MAX_QTY_PER_LINE) return;
      const previous = line.quantity;
      // Optimistic update of quantity + line total.
      setLines((prev) =>
        prev.map((l) =>
          lineKey(l) === key
            ? {
                ...l,
                quantity: nextQty,
                lineTotalPaise:
                  l.unitPricePaise != null ? l.unitPricePaise * nextQty : null,
              }
            : l,
        ),
      );
      markPending(key, true);
      const result = await updateCartQuantityAction({
        productId: line.productId,
        variantId: line.variantId ?? undefined,
        quantity: nextQty,
      });
      markPending(key, false);
      if (result.ok) {
        // The server may have clamped (e.g. up to MOQ) — reconcile.
        if (result.quantity !== nextQty) {
          setLines((prev) =>
            prev.map((l) =>
              lineKey(l) === key
                ? {
                    ...l,
                    quantity: result.quantity,
                    lineTotalPaise:
                      l.unitPricePaise != null
                        ? l.unitPricePaise * result.quantity
                        : null,
                  }
                : l,
            ),
          );
          if (result.clamped) {
            toast.info(`Quantity adjusted to ${result.quantity}.`);
          }
        }
        return;
      }
      // Revert on failure.
      setLines((prev) =>
        prev.map((l) =>
          lineKey(l) === key
            ? {
                ...l,
                quantity: previous,
                lineTotalPaise:
                  l.unitPricePaise != null ? l.unitPricePaise * previous : null,
              }
            : l,
        ),
      );
      toast.error(result.message);
    },
    [],
  );

  const patchLine = React.useCallback(
    (line: CartLineData, patch: (l: CartLineData) => CartLineData) => {
      const key = lineKey(line);
      setLines((prev) => prev.map((l) => (lineKey(l) === key ? patch(l) : l)));
    },
    [],
  );

  const removeLine = React.useCallback(async (line: CartLineData) => {
    const key = lineKey(line);
    const snapshot = line;
    setLines((prev) => prev.filter((l) => lineKey(l) !== key));
    const result = await removeCartItemAction({
      productId: line.productId,
      variantId: line.variantId ?? undefined,
    });
    if (result.ok) {
      toast.success("Removed", { description: line.name });
      return;
    }
    // Restore on failure.
    setLines((prev) => (prev.some((l) => lineKey(l) === key) ? prev : [...prev, snapshot]));
    toast.error(result.message);
  }, []);

  const placeOrder = React.useCallback(async () => {
    if (!canPlace) return;
    setPlacing(true);
    const result = await placeOrderAction({
      note: note.trim() || undefined,
      idempotencyKey: idempotencyKeyRef.current ?? undefined,
      couponCode: coupon?.code,
    });
    if (result.ok) {
      if (result.excludedCount > 0) {
        toast.info(
          `${result.excludedCount} item${result.excludedCount === 1 ? "" : "s"} couldn't be ordered and ${
            result.excludedCount === 1 ? "was" : "were"
          } left out.`,
        );
      }
      router.push(`/account/orders/confirmation?order=${encodeURIComponent(result.orderNumber)}`);
      return;
    }
    setPlacing(false);
    if ("needsLogin" in result && result.needsLogin) {
      toast.info("Please sign in to place your order.");
      router.push("/account/login");
      return;
    }
    toast.error(result.message);
    if (result.error === "coupon") {
      setCoupon(null); // the code stopped applying — order again without it
    }
    // A stale cart (something changed server-side) → refresh to re-validate.
    if (result.error === "empty" || result.error === "access") {
      router.refresh();
    }
  }, [canPlace, note, coupon, router]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      {/* Line items. On mobile the inline summary below carries the bottom
          clearance for the fixed bars; at lg the summary is a sidebar. */}
      <div className="lg:pb-0">
        {!canOrder ? (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-300">
            <Lock className="mt-0.5 size-4 shrink-0" />
            <p>
              Your pricing access has lapsed, so this cart is locked. Renew your
              access to place the order — your items are saved.
            </p>
          </div>
        ) : null}

        {renderBuckets ? (
          <BucketedLines
            billing={billing}
            lines={lines}
            pending={pending}
            canOrder={canOrder}
            priced={priced}
            reduced={reduced}
            onRemove={removeLine}
            onChangeQuantity={changeQuantity}
            onPatch={patchLine}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            <AnimatePresence mode="popLayout" initial={false}>
              {lines.map((line) => {
                const key = lineKey(line);
                return (
                  <CartLineRow
                    key={key}
                    line={line}
                    busy={pending.has(key)}
                    canOrder={canOrder}
                    priced={priced}
                    reduced={reduced}
                    onRemove={removeLine}
                    onChangeQuantity={changeQuantity}
                    onPatch={patchLine}
                  />
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>

      {/* Summary (mobile, inline) — the ONE summary on phones: the GST
          breakdown, delivery detail and note field start folded behind
          chevron rows (the delivery-minimum caveat and the "no payment now"
          line stay visible without opening anything). Placing is done from
          the sticky bar, so the Place-order button is hidden here. Bottom
          padding clears the fixed bar (+ tab nav on phones). */}
      <div className="mt-2 pb-36 md:pb-24 lg:hidden">
        <div className="rounded-xl border border-border bg-card p-4">
          <Summary
            priced={priced}
            subtotalPaise={subtotalPaise ?? initialSubtotalPaise}
            deliveryDisclosure={deliveryDisclosure}
            cartNotice={cartNotice}
            deliveryChargePaise={deliveryChargePaise}
            itemCount={itemCount}
            note={note}
            onNote={setNote}
            canPlace={canPlace}
            placing={placing}
            onPlace={placeOrder}
            canOrder={canOrder}
            tax={taxPreview}
            coupon={coupon}
            couponBusy={couponBusy}
            suggestions={suggestions}
            onApplyCoupon={applyCoupon}
            onRemoveCoupon={() => setCoupon(null)}
            billing={billing}
            hidePlaceButton
          />
        </div>
      </div>

      {/* Summary (desktop sidebar) */}
      <aside className="hidden lg:block">
        <div className="sticky top-24 rounded-xl border border-border bg-card p-4">
          <Summary
            priced={priced}
            subtotalPaise={subtotalPaise ?? initialSubtotalPaise}
            deliveryDisclosure={deliveryDisclosure}
            cartNotice={cartNotice}
            deliveryChargePaise={deliveryChargePaise}
            itemCount={itemCount}
            note={note}
            onNote={setNote}
            canPlace={canPlace}
            placing={placing}
            onPlace={placeOrder}
            canOrder={canOrder}
            tax={taxPreview}
            coupon={coupon}
            couponBusy={couponBusy}
            suggestions={suggestions}
            onApplyCoupon={applyCoupon}
            onRemoveCoupon={() => setCoupon(null)}
            billing={billing}
            movShortfallPaise={movShortfallPaise}
            minOrderValuePaise={minOrderValuePaise}
            expandDetails
          />
        </div>
      </aside>

      {/* Sticky mobile summary bar. Sits ABOVE the storefront bottom tab nav
          on phones (the nav is `fixed bottom-0 z-40 md:hidden`, ~3.5rem tall);
          from md up the nav is gone, so it drops to the very bottom. */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t border-border bg-background/95 p-3 backdrop-blur md:bottom-0 md:pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            {priced ? (
              <p className="truncate text-sm font-semibold tabular-nums">
                {formatPaise(payablePaise ?? 0)}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Price on approval</p>
            )}
            {movShortfallPaise != null ? (
              <p className="text-[0.7rem] font-medium text-amber-700 dark:text-amber-300">
                Add {formatPaise(movShortfallPaise)} more to place
              </p>
            ) : priced && nudge ? (
              <p className="truncate text-[0.7rem] font-medium text-emerald-700 dark:text-emerald-300">
                {formatPaise(nudge.hint.remainingPaise)} more for{" "}
                {formatBps(nudge.hint.tier.percentBps)} on {nudge.bucket.name.toLowerCase()}
              </p>
            ) : (
              <p className="text-[0.7rem] text-muted-foreground">
                {itemCount} item{itemCount === 1 ? "" : "s"}
                {priced && groupDiscountPaise > 0
                  ? ` · ${formatPaise(groupDiscountPaise)} saved`
                  : ""}
                {taxPreview ? " · incl. GST" : ""}
                {deliveryChargePaise > 0 ? " · incl. delivery" : ""}
              </p>
            )}
          </div>
          <Button
            onClick={placeOrder}
            disabled={!canPlace}
            className="shrink-0"
          >
            {placing ? <Loader2 className="size-4 animate-spin" /> : <ShoppingBag className="size-4" />}
            Place order
          </Button>
        </div>
      </div>
    </div>
  );
}

interface SummaryProps {
  priced: boolean;
  deliveryDisclosure?: DeliveryDisclosure | null;
  /** Owner's free-text billing notice under the summary (null = hidden). */
  cartNotice?: string | null;
  /** Delivery charge added to the grand total (paise); 0 when off. */
  deliveryChargePaise?: number;
  subtotalPaise: number | null;
  itemCount: number;
  note: string;
  onNote: (v: string) => void;
  canPlace: boolean;
  placing: boolean;
  onPlace: () => void;
  canOrder: boolean;
  /** Live GST preview, or null when GST is off / gated. */
  tax: CartTaxSummary | null;
  /** Applied coupon, when one previews successfully. */
  coupon: { code: string; discountPaise: number } | null;
  couponBusy: boolean;
  /** Store coupons quoted against this cart (applicable first). */
  suggestions: CouponSuggestionDTO[];
  onApplyCoupon: (code: string) => void;
  onRemoveCoupon: () => void;
  /** Paise still needed to reach the minimum order value, when short. */
  movShortfallPaise?: number | null;
  /** The minimum order value itself (paise), when configured + priced. */
  minOrderValuePaise?: number | null;
  /** Hide the internal Place-order button (mobile uses the sticky bar's). */
  hidePlaceButton?: boolean;
  /**
   * Open the disclosure rows (GST breakdown, delivery detail, note field) by
   * default. The desktop sidebar has the room, so it passes true; phones start
   * collapsed and the buyer opens what they need.
   */
  expandDetails?: boolean;
  /** Live billing-group mirror (bucket discounts), or null when gated / none. */
  billing?: BucketedCart | null;
}

function Summary({
  priced,
  subtotalPaise,
  movShortfallPaise = null,
  minOrderValuePaise = null,
  deliveryDisclosure = null,
  cartNotice = null,
  deliveryChargePaise = 0,
  itemCount,
  note,
  onNote,
  canPlace,
  placing,
  onPlace,
  canOrder,
  tax,
  coupon,
  couponBusy,
  suggestions,
  onApplyCoupon,
  onRemoveCoupon,
  hidePlaceButton = false,
  expandDetails = false,
  billing = null,
}: SummaryProps) {
  const [codeInput, setCodeInput] = React.useState("");
  // With GST on, the taxable base is what we call "subtotal" for an exclusive
  // catalog; for an inclusive one the tax is carved out of the line totals. We
  // display the taxable subtotal + the GST lines + the grand total.
  const showTax = priced && tax !== null;
  const discount = priced ? (coupon?.discountPaise ?? 0) : 0;
  const groupDiscount = priced ? (billing?.groupDiscountPaise ?? 0) : 0;
  // The GST grand total is already on the bucket-discounted base; without GST
  // the bucket discounts come straight off the subtotal. Coupon after either.
  // Delivery is added LAST — a charge, never discounted, never taxed here.
  const goodsTotalPaise =
    (showTax ? tax.grandTotalPaise : (subtotalPaise ?? 0) - groupDiscount) - discount;
  const grandTotalPaise = goodsTotalPaise + deliveryChargePaise;
  const discountedBuckets = billing?.buckets.filter((b) => b.discountPaise > 0) ?? [];
  // With a delivery charge the bottom line is no longer just the goods, so it
  // is always a "Grand total"; with neither GST nor delivery it stays the
  // plain "Subtotal" it has always been.
  const showDelivery = deliveryChargePaise > 0;
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-foreground">Order summary</h2>

      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">
            Items ({itemCount})
          </dt>
          <dd className="font-medium tabular-nums">
            {priced ? formatPaise(subtotalPaise ?? 0) : "—"}
          </dd>
        </div>

        {priced && groupDiscount > 0 ? (
          <BucketDiscountRows
            totalPaise={groupDiscount}
            buckets={discountedBuckets}
          />
        ) : null}

        {coupon && priced ? (
          <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-300">
            <dt className="flex items-center gap-1.5">
              Coupon {coupon.code}
              <button
                type="button"
                onClick={onRemoveCoupon}
                aria-label={`Remove coupon ${coupon.code}`}
                className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </dt>
            <dd className="font-medium tabular-nums">
              −{formatPaise(coupon.discountPaise)}
            </dd>
          </div>
        ) : null}

        {/* GST — one "Incl. ₹X GST" row; the full breakdown (taxable value,
            CGST/SGST or IGST, round-off) folds behind the chevron. */}
        {showTax ? (
          <SummaryDisclosureRow
            label={gstDisclosureLabel(tax.totalTaxPaise)}
            defaultOpen={expandDetails}
          >
            <TaxLines tax={tax} />
            {tax.supplyType === null ? (
              <p className="mt-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[0.7rem] leading-relaxed text-amber-700 dark:text-amber-300">
                GST is shown combined. Add your GSTIN in the note (or your
                profile) so we can split it into CGST/SGST or IGST on the
                proforma.
              </p>
            ) : null}
          </SummaryDisclosureRow>
        ) : null}

        {/* Delivery — a real line in the money, added after every discount and
            after GST. Owner rule: the MINIMUM caveat stays on the collapsed
            face, always visible; the chevron folds only the longer wording. */}
        {showDelivery ? (
          <SummaryDisclosureRow
            label="Delivery (minimum)"
            sublabel={DELIVERY_MINIMUM_CAVEAT}
            value={`+${formatPaise(deliveryChargePaise)}`}
            defaultOpen={expandDetails}
            className="border-t border-border pt-2"
          >
            <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
              {
                deliveryDisclosureCopy(formatPaise(deliveryChargePaise), {
                  charged: true,
                }).detail
              }
            </p>
            {deliveryDisclosure?.note ? (
              <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
                {deliveryDisclosure.note}
              </p>
            ) : null}
          </SummaryDisclosureRow>
        ) : null}

        <div className="mt-1 flex items-center justify-between border-t border-border pt-2">
          <dt className="font-semibold text-foreground">
            {showTax || showDelivery ? "Grand total" : "Subtotal"}
          </dt>
          <dd className="text-base font-semibold text-foreground tabular-nums">
            {priced ? formatPaise(grandTotalPaise) : "Price on approval"}
          </dd>
        </div>
      </dl>

      {/* Owner's billing notice (admin-editable, Settings → Ordering): e.g.
          which brands are billed WITH GST and how to ask for a GST bill.
          Plain text, whitespace-preserving; renders for EVERY viewer since it
          carries no amounts. */}
      {cartNotice ? (
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-[0.75rem] leading-relaxed whitespace-pre-line [overflow-wrap:anywhere] text-muted-foreground">
          {cartNotice}
        </p>
      ) : null}

      {/* ONE minimum-order-value line (the mobile sticky bar carries its own).
          The server re-checks the minimum at placement — this only explains
          the disabled button. */}
      {movShortfallPaise != null && minOrderValuePaise != null ? (
        <p
          role="status"
          className="text-[0.75rem] font-medium leading-relaxed text-amber-700 dark:text-amber-300"
        >
          {movLineText(movShortfallPaise, minOrderValuePaise)}
        </p>
      ) : null}

      {priced && canOrder && suggestions.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-foreground">Coupons for you</p>
          {suggestions.slice(0, 5).map((sug) => {
            const offer =
              sug.kind === "PERCENT"
                ? `${(sug.valueBps ?? 0) / 100}% off`
                : `${formatPaise(sug.amountPaise ?? 0)} off`;
            const applied = coupon?.code === sug.code;
            return (
              <div
                key={sug.code}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2",
                  sug.applicable
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : "border-border bg-muted/30 opacity-80",
                )}
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="rounded border border-dashed border-foreground/30 px-1.5 py-0.5 font-mono font-semibold tracking-wide">
                      {sug.code}
                    </span>
                    <span className="text-muted-foreground">
                      {offer}
                      {sug.scoped ? " · select products" : ""}
                    </span>
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 text-[0.7rem]",
                      sug.applicable
                        ? "font-medium text-emerald-700 dark:text-emerald-300"
                        : "text-muted-foreground",
                    )}
                  >
                    {sug.applicable
                      ? `Saves ${formatPaise(sug.discountPaise)} on this cart`
                      : sug.reasonMessage}
                  </p>
                </div>
                {sug.applicable ? (
                  <Button
                    type="button"
                    variant={applied ? "secondary" : "outline"}
                    size="sm"
                    className="h-7 shrink-0 px-2.5 text-xs"
                    disabled={couponBusy || applied}
                    onClick={() => onApplyCoupon(sug.code)}
                  >
                    {applied ? "Applied" : "Apply"}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {priced && canOrder && !coupon ? (
        <div className="flex gap-2">
          <input
            type="text"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onApplyCoupon(codeInput);
              }
            }}
            placeholder="Coupon code"
            aria-label="Coupon code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm uppercase outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <Button
            type="button"
            variant="outline"
            className="h-9"
            disabled={couponBusy || codeInput.trim() === ""}
            onClick={() => onApplyCoupon(codeInput)}
          >
            {couponBusy ? "Checking…" : "Apply"}
          </Button>
        </div>
      ) : null}
      {coupon && showTax ? (
        <p className="text-[0.65rem] leading-relaxed text-muted-foreground">
          GST is finalised on the discounted amount when you place the order.
        </p>
      ) : null}

      {/* Owner-mandated reassurance — always visible, never folded away. */}
      <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
        No payment is taken now. Placing an order sends a purchase request; our
        team confirms availability and pricing with you directly.
      </p>

      {/* Note for the seller — folded behind a chevron row on phones; the
          field itself (and the typed note) is shared with the other Summary
          instance, so nothing is lost by collapsing it here. */}
      <NoteDisclosure
        note={note}
        onNote={onNote}
        canOrder={canOrder}
        defaultOpen={expandDetails}
      />

      {/* Delivery terms with NO charge in the total (disclosed-only mode) —
          the owner-mandated notice still shows in full. When the charge is a
          money row above, that row carries the minimum caveat instead. */}
      {!showDelivery ? <DeliveryNotice delivery={deliveryDisclosure} /> : null}

      {!hidePlaceButton ? (
        <Button onClick={onPlace} disabled={!canPlace} className="w-full">
          {placing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ShoppingBag className="size-4" />
          )}
          Place order
        </Button>
      ) : null}
    </div>
  );
}

/**
 * One collapsible row inside the Summary's definition list: a chevron toggle
 * on the term, the amount pinned right, an always-visible caveat under the
 * label when one is owner-mandated, and the detail folded beneath. Phones
 * start collapsed (`defaultOpen` false); the desktop sidebar opens it.
 */
function SummaryDisclosureRow({
  label,
  sublabel,
  value,
  defaultOpen,
  className,
  children,
}: {
  label: string;
  /** Always-visible sub-line under the label — NEVER folded away. */
  sublabel?: string;
  /** Right-aligned amount on the collapsed face, when the row carries one. */
  value?: string;
  defaultOpen: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const [open, setOpen] = React.useState(defaultOpen);
  const panelId = React.useId();
  return (
    <div className={className}>
      <div className="flex items-start justify-between gap-3">
        <dt className="min-w-0 text-muted-foreground">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={panelId}
            className="inline-flex items-center gap-1 rounded text-left transition-colors hover:text-foreground"
          >
            {label}
            <ChevronDown
              className={cn(
                "size-3 shrink-0 transition-transform",
                open && "rotate-180",
              )}
              aria-hidden
            />
          </button>
          {sublabel ? (
            <span className="mt-0.5 block text-[0.7rem] leading-relaxed text-muted-foreground/80">
              {sublabel}
            </span>
          ) : null}
        </dt>
        {value != null ? (
          <dd className="shrink-0 font-semibold tabular-nums text-foreground">
            {value}
          </dd>
        ) : null}
      </div>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={panelId}
            key="panel"
            initial={reduced ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: reduced ? 0 : 0.18 }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-1 pt-1.5 pl-3 text-[0.75rem]">
              {children}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/**
 * The order-note field behind a chevron row. The note text lives in CartView
 * (shared by both Summary instances), so folding the row never loses a typed
 * note — and the collapsed label says so ("— added").
 */
function NoteDisclosure({
  note,
  onNote,
  canOrder,
  defaultOpen,
}: {
  note: string;
  onNote: (v: string) => void;
  canOrder: boolean;
  defaultOpen: boolean;
}) {
  const reduced = useReducedMotion();
  const [open, setOpen] = React.useState(defaultOpen);
  const panelId = React.useId();
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-2 rounded text-left text-xs font-medium text-foreground"
      >
        <span>
          {noteDisclosureLabel(note)}{" "}
          {note.trim() === "" ? (
            <span className="font-normal text-muted-foreground">(optional)</span>
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={panelId}
            key="panel"
            initial={reduced ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: reduced ? 0 : 0.18 }}
            className="overflow-hidden"
          >
            <div className="pt-1.5">
              <textarea
                value={note}
                onChange={(e) =>
                  onNote(e.target.value.slice(0, MAX_CART_NOTE_LENGTH))
                }
                maxLength={MAX_CART_NOTE_LENGTH}
                rows={3}
                disabled={!canOrder}
                aria-label="Note for the seller"
                placeholder="Delivery preferences, GST details, anything else…"
                className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              />
              <p className="mt-1 text-right text-[0.65rem] text-muted-foreground tabular-nums">
                {note.length}/{MAX_CART_NOTE_LENGTH}
              </p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/**
 * "Bucket discounts" row in the Summary with a collapsible per-bucket
 * breakdown ("Dealer brands · 6% · −₹1,500"). Only mounted for a priced
 * viewer with a non-zero group discount.
 */
function BucketDiscountRows({
  totalPaise,
  buckets,
}: {
  totalPaise: number;
  buckets: Bucket[];
}) {
  const reduced = useReducedMotion();
  const [open, setOpen] = React.useState(false);
  const panelId = React.useId();
  const collapsible = buckets.length > 0;
  return (
    <>
      <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-300">
        <dt className="flex items-center gap-1.5">
          Bucket discounts
          {collapsible ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls={panelId}
              className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[0.7rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Breakdown
              <ChevronDown
                className={cn("size-3 transition-transform", open && "rotate-180")}
                aria-hidden
              />
            </button>
          ) : null}
        </dt>
        <dd className="font-medium tabular-nums">−{formatPaise(totalPaise)}</dd>
      </div>
      <AnimatePresence initial={false}>
        {open && collapsible ? (
          <motion.div
            id={panelId}
            key="breakdown"
            initial={reduced ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: reduced ? 0 : 0.18 }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-1 pl-3 text-[0.75rem] text-muted-foreground">
              {buckets.map((b) => (
                <div key={b.code} className="flex items-center justify-between gap-2">
                  <dt className="min-w-0 truncate">
                    {b.name}
                    {b.appliedTier ? ` · ${formatBps(b.appliedTier.percentBps)}` : ""}
                  </dt>
                  <dd className="tabular-nums">−{formatPaise(b.discountPaise)}</dd>
                </div>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

interface BucketedLinesProps {
  billing: BucketedCart;
  lines: CartLineData[];
  pending: ReadonlySet<string>;
  canOrder: boolean;
  priced: boolean;
  reduced: boolean | null;
  onRemove: (line: CartLineData) => void;
  onChangeQuantity: (line: CartLineData, nextQty: number) => void;
  onPatch: (line: CartLineData, patch: (l: CartLineData) => CartLineData) => void;
}

/**
 * The cart split into bucket cards. Each bucket renders its own lines; any
 * line the mirror didn't bucket (unavailable / unpriced — not orderable) is
 * listed after the cards so nothing in the cart ever disappears.
 */
function BucketedLines({
  billing,
  lines,
  pending,
  canOrder,
  priced,
  reduced,
  onRemove,
  onChangeQuantity,
  onPatch,
}: BucketedLinesProps) {
  const byKey = new Map(lines.map((l) => [lineKey(l), l] as const));
  const placed = new Set<string>();
  const groups = billing.buckets.map((bucket) => {
    const bucketLines: CartLineData[] = [];
    for (const l of bucket.lines) {
      const line = byKey.get(l.key);
      if (!line) continue;
      placed.add(l.key);
      bucketLines.push(line);
    }
    return { bucket, lines: bucketLines };
  });
  const leftovers = lines.filter((l) => !placed.has(lineKey(l)));

  const row = (line: CartLineData) => {
    const key = lineKey(line);
    return (
      <CartLineRow
        key={key}
        line={line}
        busy={pending.has(key)}
        canOrder={canOrder}
        priced={priced}
        reduced={reduced}
        onRemove={onRemove}
        onChangeQuantity={onChangeQuantity}
        onPatch={onPatch}
      />
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <AnimatePresence mode="popLayout" initial={false}>
        {groups.map(({ bucket, lines: bucketLines }) => (
          <BucketCard key={bucket.code} bucket={bucket} priced={priced}>
            <ul className="flex flex-col gap-3">
              <AnimatePresence mode="popLayout" initial={false}>
                {bucketLines.map(row)}
              </AnimatePresence>
            </ul>
          </BucketCard>
        ))}
      </AnimatePresence>

      {leftovers.length > 0 ? (
        <section aria-labelledby="cart-not-orderable">
          <h2
            id="cart-not-orderable"
            className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Not orderable
          </h2>
          <ul className="flex flex-col gap-3">
            <AnimatePresence mode="popLayout" initial={false}>
              {leftovers.map(row)}
            </AnimatePresence>
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/**
 * The GST breakdown rows inside the Summary: taxable base, then CGST+SGST
 * (intra-state) OR IGST (inter-state) OR a single combined "GST" line (no place
 * of supply), plus any invoice round-off. Amounts are the live preview.
 */
function TaxLines({ tax }: { tax: CartTaxSummary }) {
  const inter = tax.supplyType === "INTER";
  const intra = tax.supplyType === "INTRA";
  return (
    <>
      <div className="flex items-center justify-between text-muted-foreground">
        <dt>Taxable value</dt>
        <dd className="tabular-nums">{formatPaise(tax.totalTaxablePaise)}</dd>
      </div>
      {intra ? (
        <>
          <div className="flex items-center justify-between text-muted-foreground">
            <dt>CGST</dt>
            <dd className="tabular-nums">{formatPaise(tax.totalCgstPaise)}</dd>
          </div>
          <div className="flex items-center justify-between text-muted-foreground">
            <dt>SGST</dt>
            <dd className="tabular-nums">{formatPaise(tax.totalSgstPaise)}</dd>
          </div>
        </>
      ) : inter ? (
        <div className="flex items-center justify-between text-muted-foreground">
          <dt>IGST</dt>
          <dd className="tabular-nums">{formatPaise(tax.totalIgstPaise)}</dd>
        </div>
      ) : (
        <div className="flex items-center justify-between text-muted-foreground">
          <dt>GST</dt>
          <dd className="tabular-nums">{formatPaise(tax.totalTaxPaise)}</dd>
        </div>
      )}
      {tax.roundOffPaise !== 0 ? (
        <div className="flex items-center justify-between text-muted-foreground">
          <dt>Round off</dt>
          <dd className="tabular-nums">
            {tax.roundOffPaise > 0 ? "+" : "−"}
            {formatPaise(Math.abs(tax.roundOffPaise))}
          </dd>
        </div>
      ) : null}
    </>
  );
}
