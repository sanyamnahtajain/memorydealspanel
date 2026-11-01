"use client"

import * as React from "react"
import { Search } from "lucide-react"

/**
 * Blinkit's phone search bar: a full-width grey pill under the header whose
 * hint cycles through what the shop sells — `Search "chargers"`, then
 * `"earbuds"`… It is a button that opens the full search overlay (typing
 * happens there), so it costs no client data. The hint holds still under
 * reduced motion.
 */
const HINTS = ["chargers", "earbuds", "cables", "power banks", "neckbands", "covers", "speakers"]
const ROTATE_MS = 2600

export function HeaderSearchBar({ onOpen, expanded }: { onOpen: () => void; expanded: boolean }) {
  const [index, setIndex] = React.useState(0)

  React.useEffect(() => {
    let reduced = false
    try {
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    } catch {
      /* no matchMedia — rotate */
    }
    if (reduced) return
    const t = setInterval(() => {
      if (document.hidden) return
      setIndex((i) => (i + 1) % HINTS.length)
    }, ROTATE_MS)
    return () => clearInterval(t)
  }, [])

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Search products"
      aria-haspopup="dialog"
      aria-expanded={expanded}
      className="flex h-11 w-full items-center gap-2.5 rounded-xl border border-border bg-muted/70 px-3.5 text-left text-[14px] text-muted-foreground outline-none transition-colors active:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Search aria-hidden className="size-[18px] shrink-0 text-foreground/80" />
      <span className="flex min-w-0 items-baseline gap-1 overflow-hidden whitespace-nowrap">
        <span>Search</span>
        <span className="relative inline-block h-5 overflow-hidden">
          <span key={index} className="md-hint-in inline-block">
            &ldquo;{HINTS[index]}&rdquo;
          </span>
        </span>
      </span>
    </button>
  )
}
