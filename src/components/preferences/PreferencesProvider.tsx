"use client"

import * as React from "react"

import {
  DEFAULT_DENSITY,
  DENSITY_COOKIE,
  PREFS_STORAGE_KEY,
} from "./prefs-script"

export type Density = "comfortable" | "compact"
export type ViewMode = "grid" | "compact" | "table"

/** Allowed page-size steps for the catalogue/list views. */
export const PAGE_SIZES = [24, 48, 96] as const
export type PageSize = (typeof PAGE_SIZES)[number]

export interface Preferences {
  /** Spacing scale applied via `data-density` on `<html>`. */
  density: Density
  /** The list view the app opens to (grid / compact / table). */
  defaultViewMode: ViewMode
  /** When true, animations are suppressed beyond the OS setting. */
  reduceMotion: boolean
  /** Results per page for paginated lists. */
  pageSize: PageSize
}

export interface PreferencesContextValue extends Preferences {
  setDensity: (density: Density) => void
  setDefaultViewMode: (mode: ViewMode) => void
  setReduceMotion: (reduce: boolean) => void
  setPageSize: (size: PageSize) => void
}

const PreferencesContext =
  React.createContext<PreferencesContextValue | null>(null)

export const DEFAULT_PREFERENCES: Preferences = {
  density: DEFAULT_DENSITY,
  defaultViewMode: "grid",
  reduceMotion: false,
  pageSize: 24,
}

function isDensity(value: unknown): value is Density {
  return value === "comfortable" || value === "compact"
}

function isViewMode(value: unknown): value is ViewMode {
  return value === "grid" || value === "compact" || value === "table"
}

function isPageSize(value: unknown): value is PageSize {
  return (PAGE_SIZES as readonly number[]).includes(value as number)
}

/** Merge a persisted (possibly partial / malformed) blob over the defaults. */
function normalize(raw: unknown): Preferences {
  if (!raw || typeof raw !== "object") return DEFAULT_PREFERENCES
  const p = raw as Record<string, unknown>
  return {
    density: isDensity(p.density) ? p.density : DEFAULT_PREFERENCES.density,
    defaultViewMode: isViewMode(p.defaultViewMode)
      ? p.defaultViewMode
      : DEFAULT_PREFERENCES.defaultViewMode,
    reduceMotion:
      typeof p.reduceMotion === "boolean"
        ? p.reduceMotion
        : DEFAULT_PREFERENCES.reduceMotion,
    pageSize: isPageSize(p.pageSize)
      ? p.pageSize
      : DEFAULT_PREFERENCES.pageSize,
  }
}

function readStored(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY)
    if (!raw) return DEFAULT_PREFERENCES
    return normalize(JSON.parse(raw) as unknown)
  } catch {
    return DEFAULT_PREFERENCES
  }
}

/** Persist density in a cookie so the server can read it during SSR. */
function writeDensityCookie(density: Density) {
  try {
    // 1-year, root-scoped, Lax — a UI preference, not sensitive.
    document.cookie = `${DENSITY_COOKIE}=${density};path=/;max-age=31536000;samesite=lax`
  } catch {
    /* ignore */
  }
}

/** Reflect density + reduce-motion onto <html> so CSS hooks can react. */
function applyToRoot(prefs: Preferences) {
  const root = document.documentElement
  root.setAttribute("data-density", prefs.density)
  if (prefs.reduceMotion) {
    root.setAttribute("data-reduce-motion", "true")
  } else {
    root.removeAttribute("data-reduce-motion")
  }
}

export interface PreferencesProviderProps {
  children: React.ReactNode
  /**
   * Density seeded on first visit / SSR before storage is read. Pass the value
   * resolved from the `md-density` cookie so the server and first client paint
   * agree. A previously stored user choice always wins on the client.
   */
  initialDensity?: Density
}

export function PreferencesProvider({
  children,
  initialDensity = DEFAULT_DENSITY,
}: PreferencesProviderProps) {
  // Seed from storage synchronously on the client. On the server (and the very
  // first client render, to keep hydration stable) fall back to the density the
  // server resolved from the cookie.
  const [prefs, setPrefs] = React.useState<Preferences>(() => {
    if (typeof window === "undefined") {
      return { ...DEFAULT_PREFERENCES, density: initialDensity }
    }
    return readStored()
  })

  // Persist the whole blob and mirror density to the cookie whenever it changes.
  const persist = React.useCallback((next: Preferences) => {
    try {
      window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
    writeDensityCookie(next.density)
  }, [])

  // Apply attributes to <html> on every change (the pre-hydration script sets
  // them for the first paint; this keeps them in sync afterwards).
  React.useEffect(() => {
    applyToRoot(prefs)
  }, [prefs])

  // Keep in sync with preferences written by other tabs/windows.
  React.useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== PREFS_STORAGE_KEY) return
      setPrefs(
        event.newValue
          ? normalize(safeParse(event.newValue))
          : DEFAULT_PREFERENCES
      )
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const update = React.useCallback(
    (patch: Partial<Preferences>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch }
        persist(next)
        return next
      })
    },
    [persist]
  )

  const value = React.useMemo<PreferencesContextValue>(
    () => ({
      ...prefs,
      setDensity: (density) => update({ density }),
      setDefaultViewMode: (defaultViewMode) => update({ defaultViewMode }),
      setReduceMotion: (reduceMotion) => update({ reduceMotion }),
      setPageSize: (pageSize) => update({ pageSize }),
    }),
    [prefs, update]
  )

  return (
    <PreferencesContext value={value}>{children}</PreferencesContext>
  )
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

/** Access the current UI preferences and their setters. */
export function usePreferences(): PreferencesContextValue {
  const ctx = React.useContext(PreferencesContext)
  if (!ctx) {
    throw new Error(
      "usePreferences must be used within a <PreferencesProvider>"
    )
  }
  return ctx
}
