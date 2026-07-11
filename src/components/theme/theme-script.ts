/**
 * Inline, render-blocking theme bootstrap.
 *
 * This string is injected verbatim into a `<script dangerouslySetInnerHTML>` in
 * the document `<head>` (see `src/app/layout.tsx`). It executes synchronously —
 * before React hydrates and before the first paint — so the correct `dark`
 * class is present on `<html>` immediately, preventing any flash of the wrong
 * theme (FOUC).
 *
 * There are exactly two themes: `'light'` and `'dark'`. First-time visitors
 * (nothing stored) always get `'light'`; a user's explicit choice is persisted
 * in `localStorage['md-theme']` and honoured on every subsequent load. There is
 * no "system"/OS-following mode.
 *
 * Keep this dependency-free, ES5-safe, and side-effect-minimal.
 */

/** localStorage key holding the user's theme preference. */
export const THEME_STORAGE_KEY = "md-theme"

/** The default preference applied when nothing is stored — always light. */
export const DEFAULT_THEME = "light"

/**
 * Minified inline bootstrap script. Wrapped in an IIFE and fully guarded so a
 * private-mode `localStorage` throw never breaks the document.
 */
export const themeScript = `(function(){try{var k="${THEME_STORAGE_KEY}";var t=null;try{t=localStorage.getItem(k)}catch(e){}if(t!=="light"&&t!=="dark")t="${DEFAULT_THEME}";var e=document.documentElement;if(t==="dark")e.classList.add("dark");else e.classList.remove("dark")}catch(e){}})();`
