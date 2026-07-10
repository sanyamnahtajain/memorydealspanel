/**
 * Inline, render-blocking UI-preferences bootstrap.
 *
 * Mirrors the theme bootstrap in `src/components/theme/theme-script.ts`: this
 * string is injected verbatim into a `<script dangerouslySetInnerHTML>` in the
 * document `<head>` (see `src/app/layout.tsx`) and executes synchronously —
 * before React hydrates and before the first paint — so the correct
 * `data-density` attribute is present on `<html>` immediately, preventing a
 * flash of the wrong spacing (FOUC).
 *
 * Preferences are persisted as a single JSON blob under `localStorage`
 * (`md-prefs`). Density is *also* mirrored into a cookie (`md-density`) by the
 * provider so the server can read it during SSR and emit the attribute in the
 * initial HTML — but this render-blocking script is the primary, flash-free
 * source of truth on the client.
 *
 * Keep this dependency-free, ES5-safe, and fully guarded so a private-mode
 * `localStorage` throw or malformed JSON never breaks the document.
 */

/** localStorage key holding the serialized UI-preferences blob. */
export const PREFS_STORAGE_KEY = "md-prefs"

/** Cookie name mirroring the density preference for SSR. */
export const DENSITY_COOKIE = "md-density"

/** The default density applied when nothing is stored. */
export const DEFAULT_DENSITY = "comfortable"

/**
 * Minified inline bootstrap script. Reads `localStorage['md-prefs']`, extracts
 * `density` (`'comfortable' | 'compact'`, defaulting to `'comfortable'`), and
 * applies it as `data-density` on `<html>`. Also honors `reduceMotion` by
 * setting `data-reduce-motion="true"` so the app can zero animations beyond the
 * OS setting from the very first paint.
 */
export const prefsScript = `(function(){try{var k="${PREFS_STORAGE_KEY}";var d="${DEFAULT_DENSITY}";var rm=false;try{var raw=localStorage.getItem(k);if(raw){var p=JSON.parse(raw);if(p&&(p.density==="comfortable"||p.density==="compact"))d=p.density;if(p&&p.reduceMotion===true)rm=true}}catch(e){}var el=document.documentElement;el.setAttribute("data-density",d);if(rm)el.setAttribute("data-reduce-motion","true")}catch(e){}})();`
