"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"

/**
 * Shared delay group for tooltips. Wrap a region (or the whole app) so that
 * once one tooltip has opened, adjacent ones show instantly instead of
 * re-waiting the full delay. Optional — a lone `<Tooltip>` works without it.
 */
function TooltipProvider({
  delay = 500,
  closeDelay = 0,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      delay={delay}
      closeDelay={closeDelay}
      {...props}
    />
  )
}

type TooltipSide = "top" | "right" | "bottom" | "left"

interface TooltipProps {
  /** Tooltip body. If nullish/empty the trigger renders bare (no tooltip). */
  content?: React.ReactNode
  /** The element the tooltip is anchored to. Must accept a ref / props. */
  children: React.ReactElement<Record<string, unknown>>
  /** Preferred side of the anchor. @default "top" */
  side?: TooltipSide
  /** Gap between the anchor and the popup, in px. @default 6 */
  sideOffset?: number
  /** Open delay in ms (overrides any provider default). @default 500 */
  delay?: number
  /** Controlled open state (optional). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Disable without unmounting the trigger. */
  disabled?: boolean
  /** Extra classes on the popup surface. */
  className?: string
}

/**
 * Themed tooltip built on Base UI. Opens on hover or keyboard focus and, on
 * touch devices, on long-press — Base UI wires the ARIA (`role="tooltip"`,
 * `aria-describedby`) and dismissal for us. Colors come from semantic tokens,
 * so it reads correctly on the light storefront and dark admin. Entrance
 * animation is skipped when the user prefers reduced motion.
 *
 * Usage:
 *   <Tooltip content="Copy link"><Button size="icon-sm"><LinkIcon/></Button></Tooltip>
 *
 * When `content` is empty the trigger is returned untouched, so it's safe to
 * pass a possibly-absent label without conditional wrappers at the call site.
 */
function Tooltip({
  content,
  children,
  side = "top",
  sideOffset = 6,
  delay,
  open,
  onOpenChange,
  disabled,
  className,
}: TooltipProps) {
  const reduced = useReducedMotion()

  const hasContent =
    content !== undefined && content !== null && content !== false && content !== ""

  if (!hasContent) {
    return children
  }

  return (
    <TooltipPrimitive.Root
      open={open}
      onOpenChange={onOpenChange}
      disabled={disabled}
    >
      <TooltipPrimitive.Trigger render={children} delay={delay} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner
          side={side}
          sideOffset={sideOffset}
          className="z-50"
        >
          <TooltipPrimitive.Popup
            data-slot="tooltip"
            data-reduced-motion={reduced ? "" : undefined}
            className={cn(
              "max-w-64 origin-(--transform-origin) rounded-md bg-foreground px-2 py-1 text-xs font-medium text-balance text-background shadow-md",
              // Entrance/exit — suppressed under reduced motion via the
              // data attribute selector below.
              "transition-[transform,scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
              "data-reduced-motion:transition-none data-reduced-motion:data-ending-style:scale-100 data-reduced-motion:data-ending-style:opacity-100 data-reduced-motion:data-starting-style:scale-100 data-reduced-motion:data-starting-style:opacity-100",
              className
            )}
          >
            {content}
            <TooltipPrimitive.Arrow className="data-[side=bottom]:top-[-6px] data-[side=left]:right-[-6px] data-[side=right]:left-[-6px] data-[side=top]:bottom-[-6px]">
              <span
                aria-hidden
                className="block size-2 rotate-45 rounded-[1px] bg-foreground"
              />
            </TooltipPrimitive.Arrow>
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

export { Tooltip, TooltipProvider, type TooltipProps, type TooltipSide }
