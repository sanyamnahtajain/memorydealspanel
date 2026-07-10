/**
 * Money utilities for MemoryDeals.
 *
 * ALL monetary amounts in the system are integer paise:
 * ₹499.50 === 49950 paise. Never floats, never rupees at rest.
 * Formatting to "₹" happens only at the UI layer via these helpers.
 */

const MAX_PAISE = Number.MAX_SAFE_INTEGER;

/** Returns true when `value` is a valid, non-negative integer paise amount. */
export function isPaise(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

/**
 * Asserts that `value` is a valid paise amount (non-negative safe integer).
 * Throws TypeError for non-numbers and RangeError for out-of-domain numbers.
 */
export function assertPaise(
  value: unknown,
  label = "amount",
): asserts value is number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new TypeError(`${label} must be a number, got ${String(value)}`);
  }
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite, got ${value}`);
  }
  if (!Number.isInteger(value)) {
    throw new RangeError(`${label} must be integer paise, got ${value}`);
  }
  if (value < 0) {
    throw new RangeError(`${label} must not be negative, got ${value}`);
  }
  if (value > MAX_PAISE) {
    throw new RangeError(`${label} exceeds the safe integer range`);
  }
}

export interface FormatPaiseOptions {
  /**
   * Compact Indian notation: ₹1.5K, ₹2.35L, ₹1.2Cr.
   * Amounts under ₹1,000 fall back to the full format.
   */
  compact?: boolean;
}

// Integer-only formatter: we never push a float through Intl, so grouping
// is exact for the full safe-integer range.
const rupeeIntFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
  useGrouping: true,
});

/**
 * Formats integer paise as an Indian-rupee string with en-IN digit grouping.
 *
 *   formatPaise(49950)     -> "₹499.50"
 *   formatPaise(49900)     -> "₹499"         (no trailing .00)
 *   formatPaise(10000000)  -> "₹1,00,000"
 *   formatPaise(15000000, { compact: true }) -> "₹1.5L"
 *
 * Always two decimal digits when a fractional part exists (tabular-friendly).
 */
export function formatPaise(
  paise: number,
  options: FormatPaiseOptions = {},
): string {
  assertPaise(paise, "paise");
  if (options.compact) {
    return formatCompact(paise);
  }
  const rupees = Math.trunc(paise / 100);
  const remainder = paise % 100;
  const grouped = rupeeIntFormatter.format(rupees);
  return remainder === 0
    ? `₹${grouped}`
    : `₹${grouped}.${String(remainder).padStart(2, "0")}`;
}

const COMPACT_UNITS: ReadonlyArray<{ value: number; suffix: string }> = [
  { value: 1_00_00_000, suffix: "Cr" }, // crore
  { value: 1_00_000, suffix: "L" }, // lakh
  { value: 1_000, suffix: "K" }, // thousand
];

function formatCompact(paise: number): string {
  const rupees = paise / 100;
  for (const unit of COMPACT_UNITS) {
    if (rupees >= unit.value) {
      // Up to 2 decimals, trailing zeros dropped by Number#toString.
      const scaled = Math.round((rupees / unit.value) * 100) / 100;
      return `₹${scaled}${unit.suffix}`;
    }
  }
  return formatPaise(paise);
}

const AMOUNT_PATTERN = /^(\d[\d,]*)(?:\.(\d{1,2}))?$/;
const CURRENCY_PREFIX = /^(?:₹|rs\.?|inr)\s*/i;

/**
 * Parses human rupee input into integer paise. Returns null for anything
 * that is not an unambiguous, non-negative rupee amount.
 *
 *   parseRupees("499.5")    -> 49950
 *   parseRupees("₹499.50")  -> 49950
 *   parseRupees("1,299")    -> 129900
 *   parseRupees("1,00,000") -> 10000000
 *   parseRupees("12,34")    -> null   (invalid grouping)
 *   parseRupees("abc")      -> null
 */
export function parseRupees(input: string): number | null {
  if (typeof input !== "string") {
    return null;
  }
  const cleaned = input.trim().replace(CURRENCY_PREFIX, "").replace(/\s+/g, "");
  if (cleaned === "") {
    return null;
  }
  const match = AMOUNT_PATTERN.exec(cleaned);
  if (!match) {
    return null;
  }
  const [, intPart, decimalPart] = match;
  if (!hasValidGrouping(intPart)) {
    return null;
  }
  const rupees = Number(intPart.replace(/,/g, ""));
  const fractionPaise = decimalPart ? Number(decimalPart.padEnd(2, "0")) : 0;
  const total = rupees * 100 + fractionPaise;
  if (!Number.isSafeInteger(total)) {
    return null;
  }
  return total;
}

/**
 * Accepts ungrouped digits, Indian grouping (1,00,000) or Western
 * grouping (100,000). Rejects malformed groups like "12,34" or "1,2,3".
 */
function hasValidGrouping(intPart: string): boolean {
  if (!intPart.includes(",")) {
    return /^\d+$/.test(intPart);
  }
  const western = /^\d{1,3}(?:,\d{3})+$/;
  const indian = /^\d{1,2}(?:,\d{2})*,\d{3}$/;
  return western.test(intPart) || indian.test(intPart);
}

export interface AdjustPaiseOptions {
  /** Percentage change, e.g. 5 for +5%, -2.5 for -2.5%. Applied first. */
  percent?: number;
  /** Absolute change in integer paise, applied after `percent`. */
  delta?: number;
}

/**
 * Adjusts a paise amount by a percentage and/or an absolute paise delta.
 * The percentage step is rounded to the nearest whole paisa before the
 * delta is applied. Throws if the result would be negative or unsafe.
 *
 *   adjustPaise(49950, { percent: 10 })  -> 54945
 *   adjustPaise(49950, { delta: -950 })  -> 49000
 */
export function adjustPaise(
  paise: number,
  { percent = 0, delta = 0 }: AdjustPaiseOptions,
): number {
  assertPaise(paise, "paise");
  if (typeof percent !== "number" || !Number.isFinite(percent)) {
    throw new TypeError(`percent must be a finite number, got ${String(percent)}`);
  }
  if (!Number.isSafeInteger(delta)) {
    throw new RangeError(`delta must be integer paise, got ${String(delta)}`);
  }
  const afterPercent = Math.round(paise * (1 + percent / 100));
  const result = afterPercent + delta;
  if (result < 0) {
    throw new RangeError(
      `adjustment produces a negative amount (${result} paise)`,
    );
  }
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("adjusted amount exceeds the safe integer range");
  }
  return result;
}
