"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { LogOut } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { logout } from "@/server/auth/actions"
import { Spinner } from "@/components/ui/spinner"

export interface SignOutButtonProps {
  /**
   * Visual treatment.
   * - `sidebar`: full-width row that matches the desktop sidebar footer.
   * - `sheet`: full-width row tuned for the mobile "More" sheet.
   * - `button`: standalone bordered button (settings → Account section).
   */
  variant?: "sidebar" | "sheet" | "button"
  /** Collapsed desktop sidebar → icon only. */
  collapsed?: boolean
  /** Fired after the logout action resolves (e.g. to close a sheet). */
  onSignedOut?: () => void
  className?: string
}

/**
 * Signs the admin out via the `logout` server action, then navigates to the
 * login screen. While the request is in flight the trigger is disabled and
 * shows a themed `<Spinner>` in place of the icon. Failures surface as a
 * sonner toast and the button re-enables so the user can retry.
 */
export function SignOutButton({
  variant = "button",
  collapsed = false,
  onSignedOut,
  className,
}: SignOutButtonProps) {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)

  const handleSignOut = React.useCallback(async () => {
    if (pending) return
    setPending(true)
    try {
      await logout()
      onSignedOut?.()
      router.push("/admin/login")
      router.refresh()
    } catch {
      setPending(false)
      toast.error("Couldn't sign out. Please try again.")
    }
  }, [pending, onSignedOut, router])

  const iconOnly = variant === "sidebar" && collapsed

  const base =
    "inline-flex items-center outline-none transition-[background-color,color,transform] duration-150 focus-visible:ring-3 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"

  const layout: Record<NonNullable<SignOutButtonProps["variant"]>, string> = {
    sidebar: cn(
      "min-h-11 w-full gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring/50",
      collapsed && "justify-center px-0",
    ),
    sheet:
      "min-h-12 w-full gap-3 rounded-xl px-3 text-sm font-medium text-destructive hover:bg-destructive/10 focus-visible:ring-destructive/40",
    button:
      "min-h-11 gap-2 rounded-lg border border-destructive/30 px-4 text-sm font-medium text-destructive hover:bg-destructive/10 focus-visible:ring-destructive/40",
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={pending}
      aria-label={iconOnly ? "Sign out" : undefined}
      aria-busy={pending}
      className={cn(base, layout[variant], className)}
    >
      <span className="relative flex shrink-0 items-center justify-center">
        {pending ? (
          <Spinner size="sm" label="Signing out" />
        ) : (
          <LogOut className="size-5" aria-hidden />
        )}
      </span>
      {!iconOnly && <span>Sign out</span>}
    </button>
  )
}
