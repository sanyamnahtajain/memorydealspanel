"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { formatPaise } from "@/lib/money";
import { minOrderableQty } from "@/lib/quantity";
import { addToCartAction } from "@/server/actions/cart";
import {
  getVariantSheetAction,
  type SheetVariant,
  type VariantSheetData,
} from "@/server/actions/variant-sheet";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { broadcastCartCount } from "./cart/CartBadge";
import { setCartLineQty } from "./cart/cart-lines-store";

/**
 * VariantQuickSheet — Flipkart-style quick variant pick for listing cards.
 *
 * A variant product's card used to NAVIGATE to the product page just to tap a
 * size; on phones that is a full page load, a scroll hunt, and a back-button
 * trip per product. Now the card shows a "Choose options" trigger that opens
 * a bottom sheet: thumb + name + gated price, size pills, add-to-cart, with
 * the product page one link away for anyone who wants the full story.
 *
 * Data is fetched ON OPEN via a server action that reuses the PDP's gated DAL
 * reads — cards stay as light as before, and the payload can never carry a
 * price the viewer isn't entitled to. Products the sheet cannot finish
 * (allocation-required, or fewer than 2 pickable variants) fall through to
 * the product page instead of showing a pointless or broken sheet.
 *
 * PRICE-GATE SAFETY: when the action says `priced: false`, every variant's
 * `pricePaise` is null and this component renders `gateSlot` — the SAME
 * server-rendered PriceGateCard node the card's footer shows (locked chip +
 * "See price" opening the request-access flow, or the customer's canonical
 * access status). No amount is ever read or formatted on the gated path.
 *
 * NESTING: the trigger lives INSIDE the card's <Link>, so (like QuickAddToCart
 * and the card HeartButton) it swallows the click — preventDefault +
 * stopPropagation — instead of following the link. The sheet itself renders in
 * a portal, outside the link subtree.
 */
export interface VariantQuickSheetProps {
  productId: string;
  slug: string;
  /**
   * The card's server-rendered price-gate node (`item.priceSlot`). Rendered
   * inside the sheet ONLY when the viewer cannot see prices, so the sheet
   * shows exactly the gate the card shows.
   */
  gateSlot: React.ReactNode;
  /** Applied to the trigger button. */
  className?: string;
}

export function VariantQuickSheet({
  productId,
  slug,
  gateSlot,
  className,
}: VariantQuickSheetProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<VariantSheetData | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [loading, startLoading] = React.useTransition();
  const [adding, startAdding] = React.useTransition();

  const variants = data?.variants ?? [];
  // Default selection prefers the in-stock default variant, then any in-stock
  // variant, then the first — mirroring the PDP selector's seeding.
  const selected =
    variants.find((v) => v.id === selectedId) ??
    variants.find((v) => v.isDefault && v.stockStatus !== "OUT_OF_STOCK") ??
    variants.find((v) => v.stockStatus !== "OUT_OF_STOCK") ??
    variants[0] ??
    null;

  function goToProduct() {
    setOpen(false);
    router.push(`/p/${slug}`);
  }

  function handleTriggerClick(e: React.MouseEvent) {
    // Lives inside the card link — never follow it on a trigger tap.
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
    if (data || loading) return;
    startLoading(async () => {
      try {
        const res = await getVariantSheetAction(productId);
        // Nothing to quick-pick (or the flow needs the breakdown builder) —
        // fall through to the full product page instead of a pointless sheet.
        if (!res.ok || res.needsFullPage) {
          goToProduct();
          return;
        }
        setData(res);
      } catch {
        goToProduct();
      }
    });
  }

  function handleAdd() {
    if (!data || !selected || adding) return;
    if (selected.stockStatus === "OUT_OF_STOCK") return;
    // Smallest orderable quantity: pack-aligned MOQ, variant override first —
    // the same shared helper the server clamp uses.
    const quantity = minOrderableQty(
      selected.moq ?? data.moq,
      selected.packMultiple ?? data.packMultiple,
    );
    startAdding(async () => {
      const result = await addToCartAction({
        productId,
        variantId: selected.id,
        quantity,
      });

      if (result.ok) {
        broadcastCartCount(result.itemCount);
        setCartLineQty(productId, selected.id, result.quantity);
        setOpen(false);
        toast.success(
          result.clamped
            ? `Added — quantity set to ${result.quantity} (minimum order).`
            : "Added to cart.",
          {
            action: {
              label: "View cart",
              onClick: () => router.push("/account/cart"),
            },
          },
        );
        return;
      }

      switch (result.reason) {
        case "needs-login":
          toast.info(result.message);
          router.push("/account/login");
          break;
        case "needs-approval":
          toast.info(result.message);
          router.push("/account?request=1");
          break;
        case "breakdown":
          // Safety net — the action flags allocation products as
          // needsFullPage, so this only fires if config changed mid-session.
          goToProduct();
          break;
        default:
          toast.error(result.message);
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={handleTriggerClick}
        className={cn(
          "flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2 text-xs font-semibold text-foreground outline-none transition-colors",
          "hover:border-primary/60 hover:bg-primary/5 hover:text-primary",
          "focus-visible:ring-3 focus-visible:ring-ring/50",
          "pointer-coarse:min-h-10",
          className,
        )}
      >
        <SlidersHorizontal aria-hidden className="size-3.5 shrink-0" />
        <span className="line-clamp-1">Choose options</span>
      </button>

      <SheetContent
        side="bottom"
        className="mx-auto w-full max-w-lg gap-0 rounded-t-2xl p-0 pb-[max(env(safe-area-inset-bottom),0.75rem)]"
        // THE PORTAL DOES NOT PROTECT US FROM THE CARD LINK. React synthetic
        // events bubble through the REACT tree, portals included — and this
        // whole component mounts INSIDE the listing card's <Link>. Without
        // this stop, tapping a size pill (or Add) bubbled up to the Link and
        // navigated to the product page a tick after the selection landed —
        // the sheet vanished mid-choice. Found in real-browser QA at 375px;
        // invisible to typecheck, lint and the test suite.
        onClick={(e) => e.stopPropagation()}
      >
        {/* Grab handle — signals "swipe me away" on touch. */}
        <div aria-hidden className="mx-auto mt-2 h-1 w-9 rounded-full bg-border" />

        {!data ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
            <SheetTitle className="sr-only">Choose options</SheetTitle>
            <Spinner size="sm" label="" />
            Loading options…
          </div>
        ) : (
          <>
            {/* Header: thumb + name + price (GATED — the card's own gate node
                when the viewer cannot see prices). */}
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              {data.image ? (
                <Image
                  src={data.image}
                  alt=""
                  width={56}
                  height={56}
                  className="size-14 shrink-0 rounded-lg border border-border bg-muted object-cover"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <SheetTitle className="line-clamp-2 pr-8 text-sm font-medium text-foreground">
                  {data.name}
                </SheetTitle>
                {data.priced ? (
                  selected?.pricePaise != null ? (
                    <p className="mt-0.5 flex items-baseline gap-2">
                      <span className="text-base font-semibold text-foreground tabular-nums">
                        {formatPaise(selected.pricePaise)}
                      </span>
                      {selected.stockStatus === "LOW" ? (
                        <span className="text-xs font-medium text-warning-foreground dark:text-warning">
                          Low stock
                        </span>
                      ) : selected.stockStatus === "OUT_OF_STOCK" ? (
                        <span className="text-xs font-medium text-muted-foreground">
                          Out of stock
                        </span>
                      ) : null}
                    </p>
                  ) : null
                ) : (
                  <div className="mt-1">{gateSlot}</div>
                )}
              </div>
            </div>

            {/* Size pills — out-of-stock ones stay visible but disabled. */}
            <div className="flex flex-wrap gap-2 px-4 py-4">
              {variants.map((v) => (
                <VariantPill
                  key={v.id}
                  variant={v}
                  active={selected?.id === v.id}
                  onSelect={() => setSelectedId(v.id)}
                />
              ))}
            </div>

            <div className="flex items-center gap-3 border-t border-border px-4 pt-3">
              <Link
                href={`/p/${slug}`}
                onClick={() => setOpen(false)}
                className={cn(
                  "text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline",
                  data.priced ? "shrink-0" : "flex-1 py-3",
                )}
              >
                View full details
              </Link>
              {data.priced ? (
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={
                    adding ||
                    !selected ||
                    selected.stockStatus === "OUT_OF_STOCK"
                  }
                  className={cn(
                    "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none transition-colors",
                    "hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
                  )}
                >
                  {adding ? <Spinner size="sm" label="" /> : null}
                  {selected?.stockStatus === "OUT_OF_STOCK"
                    ? "Out of stock"
                    : "Add to cart"}
                </button>
              ) : null}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function VariantPill({
  variant,
  active,
  onSelect,
}: {
  variant: SheetVariant;
  active: boolean;
  onSelect: () => void;
}) {
  const out = variant.stockStatus === "OUT_OF_STOCK";
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={out}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-4 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-11",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground hover:border-primary/60",
        out && "cursor-not-allowed opacity-40 line-through",
      )}
    >
      {variant.label}
    </button>
  );
}
