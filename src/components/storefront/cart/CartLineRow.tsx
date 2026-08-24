"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { Minus, Plus, Trash2, ImageOff, AlertTriangle, Loader2 } from "lucide-react";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";
import { formatPaise } from "@/lib/money";
import { clampQuantity, maxOrderableQty, minOrderableQty } from "@/lib/quantity";
import { Button } from "@/components/ui/button";
import { EditBreakdownSheet } from "@/components/storefront/allocation/EditBreakdownSheet";
import { CartLineRequirement } from "@/components/storefront/requirements/CartLineRequirement";
import { Tooltip } from "@/components/ui/tooltip";
import { StatusChip } from "@/components/common/StatusChip";
import type { CartLineIssue } from "@/server/services/cart";
import type { StockStatus } from "@/lib/schemas/shared";
import type { CartLineData } from "@/app/(storefront)/account/cart/CartView";

/** Whole-basis-points → "18%" / "18.5%" label. */
function formatRate(gstRateBps: number): string {
  const pct = gstRateBps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

export const ISSUE_COPY: Record<CartLineIssue, { label: string; tone: "warn" | "block" }> = {
  inactive: { label: "No longer available — will not be ordered", tone: "block" },
  "out-of-stock": { label: "Out of stock — will not be ordered", tone: "block" },
  "low-stock": { label: "Low stock", tone: "warn" },
  "below-moq": { label: "Below minimum — quantity will be raised at order", tone: "warn" },
  "off-pack": { label: "Not a full pack — quantity will be rounded up at order", tone: "warn" },
  "breakdown-mismatch": {
    label: "Model split needs attention — edit the models before ordering",
    tone: "block",
  },
};

function stockVariant(status: StockStatus) {
  return status === "IN_STOCK" ? "inStock" : status === "LOW" ? "low" : "outOfStock";
}

export interface CartLineRowProps {
  line: CartLineData;
  /** A mutation for this line is in flight. */
  busy: boolean;
  /** Whether the viewer may mutate (approved + live grant). */
  canOrder: boolean;
  /** Price gate — amounts render only when true. */
  priced: boolean;
  /** Reduced-motion preference (hoisted so every row agrees). */
  reduced: boolean | null;
  onRemove: (line: CartLineData) => void;
  onChangeQuantity: (line: CartLineData, nextQty: number) => void;
  /** Patch this line's local state (breakdown / requirement saves). */
  onPatch: (line: CartLineData, patch: (l: CartLineData) => CartLineData) => void;
}

/**
 * One cart line: thumbnail, name/variant, warnings, model split, requirement
 * note, quantity stepper and the (gated) price block. A `motion.li` so it can
 * enter/exit inside the parent's AnimatePresence.
 */
export function CartLineRow({
  line,
  busy,
  canOrder,
  priced,
  reduced,
  onRemove,
  onChangeQuantity,
  onPatch,
}: CartLineRowProps) {
  const fatal = line.issues.some((i) => ISSUE_COPY[i]?.tone === "block");
  return (
    <motion.li
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
          <Image src={line.imageUrl} alt="" fill sizes="80px" className="object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-muted-foreground">
            <ImageOff className="size-5" />
          </span>
        );
        const cls = "relative size-20 shrink-0 overflow-hidden rounded-lg bg-muted";
        return line.slug ? (
          <Link href={`/p/${line.slug}`} className={cls} aria-label={`View ${line.name}`}>
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
              <p className="truncate text-xs font-medium text-muted-foreground">{line.brand}</p>
            ) : null}
            {line.slug ? (
              <Link
                href={`/p/${line.slug}`}
                className="line-clamp-2 text-sm font-medium text-foreground hover:underline"
              >
                {line.name}
              </Link>
            ) : (
              <p className="line-clamp-2 text-sm font-medium text-foreground">{line.name}</p>
            )}
            {line.variantLabel ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{line.variantLabel}</p>
            ) : null}
          </div>
          <Tooltip content="Remove">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onRemove(line)}
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

        {/* Per-model split (allocation lines): summary + editor.
            The plain stepper is hidden — quantity follows the split. */}
        {line.allocationRequired ? (
          <div className="mt-2 flex flex-col gap-1.5">
            {line.breakdown && line.breakdown.length > 0 ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {line.breakdown
                  .slice(0, 3)
                  .map((b) => `${b.qty} × ${b.name}`)
                  .join(" · ")}
                {line.breakdown.length > 3 ? ` · +${line.breakdown.length - 3} more` : ""}
              </p>
            ) : null}
            <div>
              <EditBreakdownSheet
                productId={line.productId}
                variantId={line.variantId}
                moq={line.moq}
                packMultiple={line.packMultiple}
                initial={(line.breakdown ?? []).map((b) => ({
                  modelId: b.modelId,
                  name: b.name,
                  qty: b.qty,
                }))}
                disabled={!canOrder || busy}
                onSaved={(quantity, rows) => {
                  onPatch(line, (l) => ({
                    ...l,
                    quantity,
                    breakdown: rows.map((r) => ({
                      modelId: r.modelId,
                      name: r.name,
                      qty: r.qty,
                    })),
                    issues: l.issues.filter((i) => i !== "breakdown-mismatch"),
                    lineTotalPaise:
                      l.unitPricePaise != null ? l.unitPricePaise * quantity : null,
                  }));
                }}
              />
            </div>
          </div>
        ) : null}

        {/* Requirement note & photos (admin-flagged products) */}
        {line.allowRequirementNotes ? (
          <CartLineRequirement
            productId={line.productId}
            variantId={line.variantId}
            productName={line.name}
            note={line.note}
            attachments={line.attachments}
            disabled={!canOrder || busy}
            onSaved={(note, attachments) => {
              onPatch(line, (l) => ({ ...l, note, attachments }));
            }}
          />
        ) : null}

        {/* Qty + price row */}
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <div
            className={
              line.allocationRequired
                ? "hidden"
                : "inline-flex items-center rounded-lg border border-border"
            }
          >
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={
                !canOrder ||
                busy ||
                line.quantity <= minOrderableQty(line.moq, line.packMultiple)
              }
              onClick={() =>
                onChangeQuantity(
                  line,
                  clampQuantity(
                    line.quantity - Math.max(1, line.packMultiple),
                    line.moq,
                    line.packMultiple,
                    line.maxQty,
                  ),
                )
              }
              aria-label="Decrease quantity"
            >
              <Minus className="size-3.5" />
            </Button>
            <QtyInput
              value={line.quantity}
              busy={busy}
              disabled={!canOrder}
              commit={(raw) =>
                onChangeQuantity(
                  line,
                  clampQuantity(raw, line.moq, line.packMultiple, line.maxQty),
                )
              }
            />
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={
                !canOrder ||
                busy ||
                line.quantity >= maxOrderableQty(line.packMultiple, line.maxQty)
              }
              onClick={() =>
                onChangeQuantity(
                  line,
                  clampQuantity(
                    line.quantity + Math.max(1, line.packMultiple),
                    line.moq,
                    line.packMultiple,
                    line.maxQty,
                  ),
                )
              }
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
                    {line.taxInclusive ? "incl." : "+"} {formatRate(line.gstRateBps)} GST
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Price on approval</p>
            )}
          </div>
        </div>
      </div>
    </motion.li>
  );
}

/**
 * Editable quantity (the "hard to click + one by one" fix): type any number,
 * committed on blur / Enter through the SAME clamp as the server (MOQ floor,
 * pack rounding, admin max). Escape restores the current value. The draft is
 * local so typing never fires network calls per keystroke.
 */
function QtyInput({
  value,
  busy,
  disabled,
  commit,
}: {
  value: number;
  busy: boolean;
  disabled: boolean;
  commit: (raw: number) => void;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);

  function submit() {
    if (draft == null) return;
    const parsed = Number.parseInt(draft, 10);
    setDraft(null);
    if (!Number.isFinite(parsed) || parsed === value) return;
    commit(parsed);
  }

  if (busy) {
    return (
      <span className="inline-flex w-14 items-center justify-center">
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
      </span>
    );
  }
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      aria-label="Quantity"
      value={draft ?? String(value)}
      disabled={disabled}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
      onBlur={submit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      className="w-14 border-0 bg-transparent text-center text-sm font-medium tabular-nums outline-none focus-visible:bg-muted/50 disabled:opacity-50"
    />
  );
}
