"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight, ShoppingCart } from "lucide-react"

import { cn } from "@/lib/utils"
import { CART_COUNT_EVENT } from "./CartBadge"

/**
 * Blinkit's floating cart bar: once the cart has something in it, a solid
 * bar above the phone tab bar says how many items and takes you to the cart
 * in one tap — so ADD on a card never leaves you wondering where it went.
 *
 * Phones only (laptops have the header cart). Hidden where the bottom edge
 * already belongs to something else (the product page's buy bar, the cart
 * itself, the reels feed, the order confirmation). Leaves the right edge free
 * for the WhatsApp button. The count is the same number the header badge
 * shows, kept live by the cart-count event every cart change broadcasts.
 */
const QUIET_PREFIXES = ["/p/", "/account/cart", "/reels", "/account/orders/confirmation", "/gate"]

export function CartDock({ initialCount }: { initialCount: number | undefined }) {
  const pathname = usePathname()
  const [count, setCount] = React.useState(initialCount ?? 0)

  React.useEffect(() => {
    const onCount = (event: Event) => {
      const detail = (event as CustomEvent<number>).detail
      if (typeof detail === "number") setCount(detail)
    }
    window.addEventListener(CART_COUNT_EVENT, onCount)
    return () => window.removeEventListener(CART_COUNT_EVENT, onCount)
  }, [])

  if (initialCount === undefined) return null // not a customer who can order
  const quiet = QUIET_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))
  const visible = count > 0 && !quiet

  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "fixed right-[4.75rem] left-4 z-40 transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none md:hidden",
        "bottom-[calc(var(--md-tab-h,3.5rem)+0.75rem+env(safe-area-inset-bottom))]",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
      )}
    >
      <Link
        href="/account/cart"
        prefetch={false}
        tabIndex={visible ? 0 : -1}
        className="flex h-12 items-center gap-3 rounded-xl bg-primary pr-3 pl-1.5 text-primary-foreground shadow-lg outline-none active:scale-[0.98] focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex size-9 items-center justify-center rounded-lg bg-black/15">
          <ShoppingCart aria-hidden className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
          {count} {count === 1 ? "item" : "items"} in cart
        </span>
        <span className="inline-flex items-center gap-0.5 text-[14px] font-bold">
          View cart
          <ChevronRight aria-hidden className="size-4" strokeWidth={2.5} />
        </span>
      </Link>
    </div>
  )
}
