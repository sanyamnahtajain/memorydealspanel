import * as React from "react"

import { cn } from "@/lib/utils"

const spinnerSizes = {
  xs: "size-3",
  sm: "size-4",
  md: "size-5",
  lg: "size-7",
} as const

type SpinnerSize = keyof typeof spinnerSizes

interface SpinnerProps extends Omit<React.ComponentProps<"svg">, "children"> {
  /** Preset diameter. Override entirely by passing a `size-*` in `className`. */
  size?: SpinnerSize
  /**
   * Accessible label announced to assistive tech. Defaults to "Loading".
   * Pass an empty string to render the spinner purely decorative (the
   * caller is responsible for a sibling live region in that case).
   */
  label?: string
}

/**
 * A themed, dependency-free loading spinner. Renders an SVG arc that
 * inherits the current text color (`currentColor`), so it adopts whatever
 * foreground the surrounding element uses — light on the storefront, light
 * on dark in the admin. Size via the `size` prop (xs/sm/md/lg) or by
 * passing a `size-*` utility in `className`.
 */
function Spinner({ size = "md", label = "Loading", className, ...props }: SpinnerProps) {
  return (
    <svg
      data-slot="spinner"
      role="status"
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(
        "shrink-0 animate-spin text-current motion-reduce:animate-[spin_1.5s_linear_infinite]",
        spinnerSizes[size],
        className
      )}
      {...props}
    >
      {/* Track */}
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2.5"
        className="opacity-20"
      />
      {/* Arc */}
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

interface PageLoaderProps extends React.ComponentProps<"div"> {
  /** Optional caption rendered under the spinner (e.g. "Loading products…"). */
  label?: string
  /** Spinner diameter preset. Defaults to `lg` for route-level UI. */
  size?: SpinnerSize
}

/**
 * Centered, route-level loading state. Drop into a `loading.tsx` or any
 * pending Suspense boundary. Fills its parent and vertically centers a
 * spinner with an optional caption.
 */
function PageLoader({ label, size = "lg", className, ...props }: PageLoaderProps) {
  return (
    <div
      data-slot="page-loader"
      role="status"
      aria-live="polite"
      className={cn(
        "flex min-h-40 w-full flex-col items-center justify-center gap-3 text-muted-foreground",
        className
      )}
      {...props}
    >
      <Spinner size={size} label={label ? "" : "Loading"} />
      {label ? <p className="text-sm">{label}</p> : null}
    </div>
  )
}

export { Spinner, PageLoader, type SpinnerSize }
