/**
 * Inline, render-blocking theme bootstrap.
 *
 * This string is injected verbatim into a `<script dangerouslySetInnerHTML>` in
 * the document `<head>` (see `src/app/layout.tsx`). It executes synchronously —
 * before React hydrates and before the first paint — so the correct `dark`
 * class is present on `<html>` immediately, preventing any flash of the wrong
 * theme (FOUC).
 *
 * Keep this dependency-free, ES5-safe, and side-effect-minimal: it reads the
 * persisted preference from `localStorage['md-theme']` (one of
 * `'light' | 'dark' | 'system'`, defaulting to `'system'`), resolves `system`
 * via `matchMedia('(prefers-color-scheme: dark)')`, and toggles the `dark`
 * class on `document.documentElement`.
 */

/** localStorage key holding the user's theme preference. */
export const THEME_STORAGE_KEY = "md-theme"

/** The default preference applied when nothing is stored. */
export const DEFAULT_THEME = "system"

/**
 * Minified inline bootstrap script. Wrapped in an IIFE and fully guarded so a
 * private-mode `localStorage` throw or a missing `matchMedia` never breaks the
 * document.
 */
export const themeScript = `(function(){try{var k="${THEME_STORAGE_KEY}";var t=null;try{t=localStorage.getItem(k)}catch(e){}if(t!=="light"&&t!=="dark"&&t!=="system")t="${DEFAULT_THEME}";var d=t==="dark"||(t==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;if(d)e.classList.add("dark");else e.classList.remove("dark")}catch(e){}})();`
