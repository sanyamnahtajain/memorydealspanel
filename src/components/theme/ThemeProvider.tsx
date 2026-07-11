"use client"

import * as React from "react"

import { DEFAULT_THEME, THEME_STORAGE_KEY } from "./theme-script"

/** The two themes. There is no "system"/OS-following mode. */
export type Theme = "light" | "dark"
/** Kept as an alias of {@link Theme} for existing consumers. */
export type ResolvedTheme = Theme

export interface ThemeContextValue {
  /** The user's current theme (persisted; defaults to `'light'`). */
  theme: Theme
  /** Same as `theme` — the concrete applied theme. */
  resolvedTheme: ResolvedTheme
  /** Persist a new theme and apply it immediately. */
  setTheme: (theme: Theme) => void
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark"
}

/** Apply/remove the `dark` class on `<html>` to match the theme. */
function applyClass(theme: Theme) {
  const root = document.documentElement
  root.classList.toggle("dark", theme === "dark")
  root.style.colorScheme = theme
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
   * Theme to seed on a first visit when nothing is stored yet. Defaults to
   * `'light'` — first-time visitors always start in light mode. A previously
   * stored user choice always wins.
   */
  defaultTheme?: Theme
}

export function ThemeProvider({
  children,
  defaultTheme = DEFAULT_THEME,
}: ThemeProviderProps) {
  // Seed from storage synchronously; if nothing (valid) is stored, use
  // defaultTheme (light) and persist it below so the pre-hydration script picks
  // it up on the next load.
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

  // On mount, persist the seeded default on a first visit so the pre-hydration
  // inline script resolves to the same theme next load.
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

  // Keep in sync with a choice made in another tab/window.
  React.useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return
      setThemeState(isTheme(event.newValue) ? event.newValue : DEFAULT_THEME)
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  // Apply the theme to <html> and the meta tag on every change.
  React.useEffect(() => {
    applyClass(theme)
    syncMetaThemeColor()
  }, [theme])

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next)
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme: theme, setTheme }),
    [theme, setTheme]
  )

  return <ThemeContext value={value}>{children}</ThemeContext>
}

/** Access the current theme and setter. */
export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) {
    throw new Error("useTheme must be used within a <ThemeProvider>")
  }
  return ctx
}
