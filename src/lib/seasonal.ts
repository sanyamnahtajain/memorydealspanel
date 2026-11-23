/**
 * Seasonal look — the ONE place that decides whether the shop wears its
 * winter / Christmas touches (snowfall, snow on the header, a hat on the
 * logo, the footer scene) and how much of it.
 *
 * Rules that keep it from ever getting in a buyer's way live here and in the
 * components, not in anyone's memory:
 *  - decoration only: every piece is `pointer-events: none` + `aria-hidden`,
 *    and the snowfall sits BEHIND the content, so a flake never covers a
 *    price, a photo or a button;
 *  - "auto" follows the calendar (India time), so it switches itself on in
 *    mid-November and retires itself in mid-January — nobody has to remember;
 *  - the owner can force it on or off, tone the snow down, or keep it out of
 *    the admin console (Settings → Seasonal look);
 *  - each viewer's "reduce motion" (system or in-app) and Data Saver stop the
 *    snowfall on their device (see Snowfall).
 *
 * Pure: no server imports. Stored as JSON on StoreSettings.seasonal and parsed
 * defensively — a malformed row means "auto", never a crash.
 */

export type SeasonMode = "auto" | "on" | "off";
export type SnowLevel = "off" | "light" | "normal";

export interface SeasonalSettings {
  mode: SeasonMode;
  /** How much snow falls. */
  snow: SnowLevel;
  /** Festive extras: the Santa hat on the logo and the twinkling lights. */
  christmas: boolean;
  /** Also decorate the admin console (lighter snowfall there). */
  admin: boolean;
  /** Soft sleigh bells when Santa's sleigh flies by (once per visit). */
  sounds: boolean;
}

export const DEFAULT_SEASONAL: SeasonalSettings = {
  mode: "auto",
  snow: "light",
  christmas: true,
  admin: true,
  sounds: true,
};

/** What the screens actually render, after the calendar and settings. */
export interface Season {
  winter: boolean;
  snow: SnowLevel;
  christmas: boolean;
  admin: boolean;
  sounds: boolean;
}

export const NO_SEASON: Season = { winter: false, snow: "off", christmas: false, admin: false, sounds: false };

/**
 * Auto window, in India time: 15 November → 15 January (inclusive). Long
 * enough to cover the wedding-season winter and New Year, short enough that
 * snow is never on the site in spring.
 */
export const WINTER_WINDOW = { from: { month: 11, day: 15 }, until: { month: 1, day: 15 } } as const;

const MODES: readonly SeasonMode[] = ["auto", "on", "off"];
const SNOW: readonly SnowLevel[] = ["off", "light", "normal"];

export function parseSeasonal(raw: unknown): SeasonalSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_SEASONAL };
  const r = raw as Record<string, unknown>;
  return {
    mode: MODES.includes(r.mode as SeasonMode) ? (r.mode as SeasonMode) : DEFAULT_SEASONAL.mode,
    snow: SNOW.includes(r.snow as SnowLevel) ? (r.snow as SnowLevel) : DEFAULT_SEASONAL.snow,
    christmas: typeof r.christmas === "boolean" ? r.christmas : DEFAULT_SEASONAL.christmas,
    admin: typeof r.admin === "boolean" ? r.admin : DEFAULT_SEASONAL.admin,
    sounds: typeof r.sounds === "boolean" ? r.sounds : DEFAULT_SEASONAL.sounds,
  };
}

/** Month (1–12) and day in India time — the shop's calendar, not the server's. */
export function indiaMonthDay(now: Date): { month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { month: get("month"), day: get("day") };
}

/** Is `now` inside the auto winter window (which wraps the new year)? */
export function inWinterWindow(now: Date): boolean {
  const { month, day } = indiaMonthDay(now);
  const md = month * 100 + day;
  const from = WINTER_WINDOW.from.month * 100 + WINTER_WINDOW.from.day;
  const until = WINTER_WINDOW.until.month * 100 + WINTER_WINDOW.until.day;
  return md >= from || md <= until;
}

export function resolveSeason(settings: SeasonalSettings, now: Date = new Date()): Season {
  const winter =
    settings.mode === "on" ? true : settings.mode === "off" ? false : inWinterWindow(now);
  if (!winter) return NO_SEASON;
  return {
    winter,
    snow: settings.snow,
    christmas: settings.christmas,
    admin: settings.admin,
    sounds: settings.sounds,
  };
}

/**
 * Flakes per screen width — few on a phone (small screen, slow CPU), more on
 * a desktop. "normal" is half again as many.
 */
export function flakeCount(width: number, level: SnowLevel, surface: "storefront" | "admin"): number {
  if (level === "off") return 0;
  const base = width < 640 ? 10 : width < 1024 ? 16 : 24;
  const scaled = level === "normal" ? Math.round(base * 1.5) : base;
  return surface === "admin" ? Math.round(scaled * 0.6) : scaled;
}
