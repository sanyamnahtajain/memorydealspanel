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
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Minus,
  Plus,
  Trash2,
  ImageOff,
  AlertTriangle,
  Loader2,
  ShoppingBag,
  Lock,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { formatPaise } from "@/lib/money";
import { MAX_CART_NOTE_LENGTH, MAX_QTY_PER_LINE } from "@/lib/schemas/cart";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { StatusChip } from "@/components/common/StatusChip";
import {
  updateCartQuantityAction,
  removeCartItemAction,
} from "@/server/actions/cart";
import { placeOrderAction } from "@/server/actions/orders";
import type { CartLineIssue, CartTaxSummary } from "@/server/services/cart";
import type { StockStatus } from "@/lib/schemas/shared";

/** Whole-basis-points → "18%" / "18.5%" label. */
function formatRate(gstRateBps: number): string {
  const pct = gstRateBps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

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
}

/** A stable per-line key (product + variant pair is unique in a cart). */
function lineKey(l: { productId: string; variantId: string | null }): string {
  return `${l.productId}:${l.variantId ?? ""}`;
}

const ISSUE_COPY: Record<CartLineIssue, { label: string; tone: "warn" | "block" }> = {
  inactive: { label: "No longer available — will not be ordered", tone: "block" },
  "out-of-stock": { label: "Out of stock — will not be ordered", tone: "block" },
  "low-stock": { label: "Low stock", tone: "warn" },
  "below-moq": { label: "Below minimum — quantity will be raised at order", tone: "warn" },
};

function stockVariant(status: StockStatus) {
  return status === "IN_STOCK" ? "inStock" : status === "LOW" ? "low" : "outOfStock";
}

export function CartView({
  initialLines,
  initialSubtotalPaise,
  priced,
  canOrder,
  initialTax,
}: CartViewProps) {
  const router = useRouter();
  const reduced = useReducedMotion();

  const [lines, setLines] = React.useState<CartLineData[]>(initialLines);
  const [pending, setPending] = React.useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = React.useState("");
  const [placing, setPlacing] = React.useState(false);
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
  const canPlace = canOrder && orderableLines.length > 0 && !placing;

  // Live GST preview: re-derived from the current (possibly optimistic) line
  // quantities using the same integer formula as the server, then split by the
  // supply type the server determined. When GST is off (initialTax null) the
  // whole block is absent and the cart renders exactly as pre-GST.
  const taxPreview = React.useMemo(() => {
    if (!priced || !initialTax) return null;
    let totalTaxablePaise = 0;
    let totalTaxPaise = 0;
    let grossPaise = 0;
    for (const l of orderableLines) {
      if (l.gstRateBps === null || l.lineTotalPaise === null) continue;
      const t = lineTaxOf(l.lineTotalPaise, l.gstRateBps, l.taxInclusive);
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
  }, [priced, initialTax, orderableLines]);

  // The customer-facing total that "Place order" commits to: the GST grand
  // total when GST applies, else the plain subtotal.
  const payablePaise = taxPreview ? taxPreview.grandTotalPaise : subtotalPaise;

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
    // A stale cart (something changed server-side) → refresh to re-validate.
    if (result.error === "empty" || result.error === "access") {
      router.refresh();
    }
  }, [canPlace, note, router]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      {/* Line items. Extra bottom padding on mobile clears the fixed summary
          bar (+ the storefront bottom tab nav on phones); none needed at lg
          where the summary is an inline sidebar. */}
      <div className="pb-36 md:pb-24 lg:pb-0">
        {!canOrder ? (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-300">
            <Lock className="mt-0.5 size-4 shrink-0" />
            <p>
              Your pricing access has lapsed, so this cart is locked. Renew your
              access to place the order — your items are saved.
            </p>
          </div>
        ) : null}

        <ul className="flex flex-col gap-3">
          <AnimatePresence mode="popLayout" initial={false}>
            {lines.map((line) => {
              const key = lineKey(line);
              const busy = pending.has(key);
              const fatal = line.issues.some(
                (i) => ISSUE_COPY[i]?.tone === "block",
              );
              return (
                <motion.li
                  key={key}
                  layout={!reduced}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, x: -12, height: 0 }}
                  transition={{ duration: reduced ? 0 : 0.18 }}
                  className={cn(
                    "relative flex gap-3 rounded-xl border border-border bg-card p-3",
                    fatal && "opacity-70",
                  )}
                >
                  {(() => {
                    const thumb = line.imageUrl ? (
                      <Image
                        src={line.imageUrl}
                        alt=""
                        fill
                        sizes="80px"
                        className="object-cover"
                      />
                    ) : (
                      <span className="flex size-full items-center justify-center text-muted-foreground">
                        <ImageOff className="size-5" />
                      </span>
                    );
                    const cls =
                      "relative size-20 shrink-0 overflow-hidden rounded-lg bg-muted";
                    return line.slug ? (
                      <Link
                        href={`/products/${line.slug}`}
                        className={cls}
                        aria-label={`View ${line.name}`}
                      >
                        {thumb}
                      </Link>
                    ) : (
                      <div className={cls}>{thumb}</div>
                    );
                  })()}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {line.brand ? (
                          <p className="truncate text-xs font-medium text-muted-foreground">
                            {line.brand}
                          </p>
                        ) : null}
                        {line.slug ? (
                          <Link
                            href={`/products/${line.slug}`}
                            className="line-clamp-2 text-sm font-medium text-foreground hover:underline"
                          >
                            {line.name}
                          </Link>
                        ) : (
                          <p className="line-clamp-2 text-sm font-medium text-foreground">
                            {line.name}
                          </p>
                        )}
                        {line.variantLabel ? (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {line.variantLabel}
                          </p>
                        ) : null}
                        <p className="mt-0.5 truncate text-[0.7rem] text-muted-foreground/80">
                          {line.sku}
                        </p>
                      </div>
                      <Tooltip content="Remove">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeLine(line)}
                          aria-label={`Remove ${line.name}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </Tooltip>
                    </div>

                    {/* Warnings */}
                    {line.issues.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {line.stockStatus !== "IN_STOCK" ? (
                          <StatusChip variant={stockVariant(line.stockStatus)} />
                        ) : null}
                        {line.issues
                          .filter((i) => i !== "low-stock" && i !== "out-of-stock")
                          .map((issue) => (
                            <span
                              key={issue}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.7rem] font-medium",
                                ISSUE_COPY[issue]?.tone === "block"
                                  ? "bg-destructive/10 text-destructive"
                                  : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                              )}
                            >
                              <AlertTriangle className="size-3" />
                              {ISSUE_COPY[issue]?.label ?? issue}
                            </span>
                          ))}
                      </div>
                    ) : null}

                    {/* Qty + price row */}
                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <div className="inline-flex items-center rounded-lg border border-border">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={!canOrder || busy || line.quantity <= 1}
                          onClick={() => changeQuantity(line, line.quantity - 1)}
                          aria-label="Decrease quantity"
                        >
                          <Minus className="size-3.5" />
                        </Button>
                        <span className="min-w-9 text-center text-sm font-medium tabular-nums">
                          {busy ? (
                            <Loader2 className="mx-auto size-3.5 animate-spin text-muted-foreground" />
                          ) : (
                            line.quantity
                          )}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={!canOrder || busy || line.quantity >= MAX_QTY_PER_LINE}
                          onClick={() => changeQuantity(line, line.quantity + 1)}
                          aria-label="Increase quantity"
                        >
                          <Plus className="size-3.5" />
                        </Button>
                      </div>

                      <div className="text-right">
                        {priced && line.unitPricePaise != null ? (
                          <>
                            <p className="text-sm font-semibold text-foreground tabular-nums">
                              {formatPaise(line.lineTotalPaise ?? 0)}
                            </p>
                            <p className="text-[0.7rem] text-muted-foreground tabular-nums">
                              {formatPaise(line.unitPricePaise)} each
                            </p>
                            {line.gstRateBps != null ? (
                              <p className="text-[0.65rem] text-muted-foreground">
                                {line.taxInclusive ? "incl." : "+"}{" "}
                                {formatRate(line.gstRateBps)} GST
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Price on approval
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      </div>

      {/* Summary (desktop sidebar) */}
      <aside className="hidden lg:block">
        <div className="sticky top-24 rounded-xl border border-border bg-card p-4">
          <Summary
            priced={priced}
            subtotalPaise={subtotalPaise ?? initialSubtotalPaise}
            itemCount={itemCount}
            note={note}
            onNote={setNote}
            canPlace={canPlace}
            placing={placing}
            onPlace={placeOrder}
            canOrder={canOrder}
            tax={taxPreview}
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
            <p className="text-[0.7rem] text-muted-foreground">
              {itemCount} item{itemCount === 1 ? "" : "s"}
              {taxPreview ? " · incl. GST" : ""}
            </p>
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
}

function Summary({
  priced,
  subtotalPaise,
  itemCount,
  note,
  onNote,
  canPlace,
  placing,
  onPlace,
  canOrder,
  tax,
}: SummaryProps) {
  // With GST on, the taxable base is what we call "subtotal" for an exclusive
  // catalog; for an inclusive one the tax is carved out of the line totals. We
  // display the taxable subtotal + the GST lines + the grand total.
  const showTax = priced && tax !== null;
  const grandTotalPaise = showTax ? tax.grandTotalPaise : subtotalPaise ?? 0;
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

        {showTax ? (
          <TaxLines tax={tax} />
        ) : null}

        <div className="mt-1 flex items-center justify-between border-t border-border pt-2">
          <dt className="font-semibold text-foreground">
            {showTax ? "Grand total" : "Subtotal"}
          </dt>
          <dd className="text-base font-semibold text-foreground tabular-nums">
            {priced ? formatPaise(grandTotalPaise) : "Price on approval"}
          </dd>
        </div>
      </dl>

      {showTax && tax.supplyType === null ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[0.7rem] leading-relaxed text-amber-700 dark:text-amber-300">
          GST is shown combined. Add your GSTIN in the note (or your profile) so
          we can split it into CGST/SGST or IGST on the proforma.
        </p>
      ) : null}

      <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
        No payment is taken now. Placing an order sends a purchase request; our
        team confirms availability and pricing with you directly.
      </p>

      <div>
        <label
          htmlFor="order-note"
          className="mb-1 block text-xs font-medium text-foreground"
        >
          Note for the seller{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="order-note"
          value={note}
          onChange={(e) => onNote(e.target.value.slice(0, MAX_CART_NOTE_LENGTH))}
          maxLength={MAX_CART_NOTE_LENGTH}
          rows={3}
          disabled={!canOrder}
          placeholder="Delivery preferences, GST details, anything else…"
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        />
        <p className="mt-1 text-right text-[0.65rem] text-muted-foreground tabular-nums">
          {note.length}/{MAX_CART_NOTE_LENGTH}
        </p>
      </div>

      <Button onClick={onPlace} disabled={!canPlace} className="w-full">
        {placing ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ShoppingBag className="size-4" />
        )}
        Place order
      </Button>
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
