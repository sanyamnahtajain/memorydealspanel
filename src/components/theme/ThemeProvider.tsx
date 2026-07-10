"use client"

import * as React from "react"

import { DEFAULT_THEME, THEME_STORAGE_KEY } from "./theme-script"

export type Theme = "light" | "dark" | "system"
export type ResolvedTheme = "light" | "dark"

export interface ThemeContextValue {
  /** The user's stored preference. `'system'` follows the OS. */
  theme: Theme
  /** The concrete theme currently applied (`system` resolved to light/dark). */
  resolvedTheme: ResolvedTheme
  /** Persist a new preference and apply it immediately. */
  setTheme: (theme: Theme) => void
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

const MEDIA_QUERY = "(prefers-color-scheme: dark)"

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system"
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false
  return window.matchMedia(MEDIA_QUERY).matches
}

function resolve(theme: Theme, systemDark: boolean): ResolvedTheme {
  if (theme === "system") return systemDark ? "dark" : "light"
  return theme
}

/** Apply/remove the `dark` class on `<html>` to match the resolved theme. */
function applyClass(resolved: ResolvedTheme) {
  const root = document.documentElement
  root.classList.toggle("dark", resolved === "dark")
  root.style.colorScheme = resolved
}

/**
 * Sync the `<meta name="theme-color">` tag to the active surface color so the
 * browser/PWA chrome matches the theme. Reads the *computed* `--background`
 * (resolved to a real color) rather than duplicating token values here.
 */
function syncMetaThemeColor() {
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]'
  )
  if (!meta) return
  const bg = getComputedStyle(document.documentElement)
    .getPropertyValue("--background")
    .trim()
  if (bg) meta.setAttribute("content", bg)
}

export interface ThemeProviderProps {
  children: React.ReactNode
  /**
   * Preference to seed on first visit when nothing is stored yet. Lets the
   * admin area default to `dark` while the storefront defaults to `system`.
   * A previously stored user choice always wins.
   */
  defaultTheme?: Theme
}

export function ThemeProvider({
  children,
  defaultTheme = DEFAULT_THEME,
}: ThemeProviderProps) {
  // Seed from storage synchronously; if nothing stored, use defaultTheme and
  // persist it so the pre-hydration script picks it up on the next load.
  const [theme, setThemeState] = React.useState<Theme>(() => {
    if (typeof window === "undefined") return defaultTheme
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
      if (isTheme(stored)) return stored
    } catch {
      /* ignore */
    }
    return defaultTheme
  })

  const [systemDark, setSystemDark] = React.useState<boolean>(() =>
    systemPrefersDark()
  )

  const resolvedTheme = resolve(theme, systemDark)

  // On mount, persist the seeded default if this is a first visit, so the
  // pre-hydration inline script resolves to the same theme on subsequent
  // loads. Writing to storage is an external side-effect (no React setState).
  React.useEffect(() => {
    let hasStored = false
    try {
      hasStored = isTheme(window.localStorage.getItem(THEME_STORAGE_KEY))
    } catch {
      hasStored = false
    }
    if (!hasStored) {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, defaultTheme)
      } catch {
        /* ignore */
      }
    }
  }, [defaultTheme])

  // Keep in sync with the preference written by other tabs/windows.
  React.useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return
      setThemeState(isTheme(event.newValue) ? event.newValue : DEFAULT_THEME)
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  // Track OS preference while (and only while) following the system.
  React.useEffect(() => {
    if (theme !== "system") return
    if (typeof window === "undefined" || !window.matchMedia) return
    const mql = window.matchMedia(MEDIA_QUERY)
    const onChange = (event: MediaQueryListEvent) => {
      setSystemDark(event.matches)
    }
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [theme])

  // Apply the resolved theme to <html> and the meta tag on every change.
  React.useEffect(() => {
    applyClass(resolvedTheme)
    syncMetaThemeColor()
  }, [resolvedTheme])

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next)
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  )

  return <ThemeContext value={value}>{children}</ThemeContext>
}

/** Access the current theme, resolved theme, and setter. */
export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) {
    throw new Error("useTheme must be used within a <ThemeProvider>")
  }
  return ctx
}
