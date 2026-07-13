"use client";

/**
 * WishlistCard + WishlistGrid — the interactive saved-products list.
 *
 * Each card shows the product image, brand/name, key meta, and the SERVER-built
 * `priceSlot` (a real price only for an approved viewer, else the locked gate
 * chip — no amount ever crosses into this client component). Actions per card:
 *   - View — navigate to the product page.
 *   - Enquire — WhatsApp deep link (a full enquiry cart lands in a later phase;
 *     this is the clean seam for now, no stub).
 *   - Remove — optimistically drops the card and calls the IDOR-safe server
 *     action; on failure the card animates back in with a toast.
 *
 * The heart/remove keeps the header WishlistBadge in lock-step via
 * `broadcastWishlistCount`.
 */

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { ImageOff, Trash2, MessageCircle, Eye } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { StatusChip } from "@/components/common/StatusChip";
import { BrandBadge } from "@/components/storefront/BrandBadge";
import { stockChipVariant } from "@/components/storefront/listing/product-display";
import { broadcastWishlistCount } from "@/components/storefront/wishlist/WishlistBadge";
import { removeWishlistAction } from "@/server/actions/wishlist";
import type { StockStatus } from "@/lib/schemas/shared";

/** The client-safe shape for one saved product (NO money — priceSlot is gated). */
export interface WishlistCardData {
  productId: string;
  slug: string;
  name: string;
  sku: string;
  brandName: string | null;
  brandSlug: string | null;
  imageUrl: string | null;
  moq: number | null;
  stockStatus: StockStatus;
  note: string | null;
  /** WhatsApp enquiry deep link (built server-side; carries no price). */
  enquireHref: string;
  /** Server-rendered gated price node. */
  priceSlot: React.ReactNode;
}

interface WishlistGridProps {
  items: WishlistCardData[];
  /** Authoritative saved count from the server (drives the header badge). */
  totalCount: number;
}

export function WishlistGrid({ items, totalCount }: WishlistGridProps) {
  const reduced = useReducedMotion();
  // Track removed product ids so the grid updates optimistically without a
  // server round-trip blocking the exit animation.
  const [removed, setRemoved] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const visible = items.filter((it) => !removed.has(it.productId));

  const handleRemove = React.useCallback(
    async (item: WishlistCardData) => {
      // Optimistic drop + optimistic badge decrement (server reconciles below).
      setRemoved((prev) => {
        if (prev.has(item.productId)) return prev;
        const next = new Set(prev).add(item.productId);
        broadcastWishlistCount(Math.max(0, totalCount - next.size));
        return next;
      });

      const result = await removeWishlistAction(item.productId);
      if (result.ok) {
        broadcastWishlistCount(result.count);
        toast.success("Removed from wishlist", { description: item.name });
        return;
      }
      // Revert.
      setRemoved((prev) => {
        const next = new Set(prev);
        next.delete(item.productId);
        broadcastWishlistCount(Math.max(0, totalCount - next.size));
        return next;
      });
      if ("needsLogin" in result && result.needsLogin) {
        toast.info("Sign in to manage your wishlist.");
      } else {
        toast.error(
          "error" in result ? result.error : "Couldn't remove that product.",
        );
      }
    },
    [totalCount],
  );

  return (
    <motion.ul
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
      initial={reduced ? "show" : "hidden"}
      animate="show"
    >
      <AnimatePresence mode="popLayout">
        {visible.map((item) => (
          <motion.li
            key={item.productId}
            layout={!reduced}
            variants={{
              hidden: { opacity: 0, y: 12 },
              show: { opacity: 1, y: 0 },
            }}
            exit={
              reduced
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.94, transition: { duration: 0.18 } }
            }
          >
            <WishlistCard item={item} onRemove={() => handleRemove(item)} />
          </motion.li>
        ))}
      </AnimatePresence>
    </motion.ul>
  );
}

function WishlistCard({
  item,
  onRemove,
}: {
  item: WishlistCardData;
  onRemove: () => void;
}) {
  const [removing, setRemoving] = React.useState(false);

  return (
    <div className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      <Link
        href={`/p/${item.slug}`}
        className="relative block aspect-[4/3] w-full overflow-hidden bg-muted outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
        aria-label={`View ${item.name}`}
      >
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 90vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="size-8" aria-hidden />
          </div>
        )}
        <div className="absolute top-2 left-2">
          <StatusChip variant={stockChipVariant(item.stockStatus)} />
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        {item.brandName ? (
          <BrandBadge
            name={item.brandName}
            slug={item.brandSlug ?? ""}
            asLink={false}
          />
        ) : null}
        <Link
          href={`/p/${item.slug}`}
          className="line-clamp-2 text-sm font-semibold text-foreground outline-none hover:text-primary focus-visible:text-primary focus-visible:underline"
        >
          {item.name}
        </Link>
        {item.moq !== null ? (
          <p className="font-tabular text-xs text-muted-foreground">
            MOQ {item.moq}
          </p>
        ) : null}

        {item.note ? (
          <p className="line-clamp-2 rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
            {item.note}
          </p>
        ) : null}

        <div className="mt-1">{item.priceSlot}</div>

        <div className="mt-auto flex items-center gap-1.5 pt-3">
          <Button
            render={<Link href={`/p/${item.slug}`} />}
            variant="outline"
            size="sm"
            className="flex-1"
          >
            <Eye aria-hidden />
            View
          </Button>
          <Button
            render={
              <a
                href={item.enquireHref}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
            variant="secondary"
            size="sm"
            className="flex-1"
            aria-label={`Enquire about ${item.name} on WhatsApp`}
          >
            <MessageCircle aria-hidden />
            Enquire
          </Button>
          <Tooltip content="Remove">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={removing}
              aria-label={`Remove ${item.name} from wishlist`}
              onClick={() => {
                setRemoving(true);
                onRemove();
              }}
              className={cn(
                "text-muted-foreground hover:text-destructive",
                removing && "opacity-60",
              )}
            >
              <Trash2 aria-hidden />
            </Button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
