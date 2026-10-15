import { formatPaise } from "@/lib/money";

const numberFmt = new Intl.NumberFormat("en-IN");

export const fmtInt = (n: number) => numberFmt.format(n);

/** ₹ in compact form for headlines ("₹1.5L"), full form under 1 lakh. */
export function fmtMoney(paise: number, compact = false): string {
  if (compact && paise >= 10_000_000) return formatPaise(paise, { compact: true });
  // Headline figures read in whole rupees; the paise never matter at this size.
  return formatPaise(compact ? Math.round(paise / 100) * 100 : paise);
}

/**
 * Percentage change vs a previous figure, rounded to a whole percent.
 * Undefined when there is nothing to compare against (previous = 0), so the
 * card shows no arrow rather than a misleading +100%.
 */
export function pctDelta(current: number, previous: number): number | undefined {
  if (previous <= 0) return undefined;
  return Math.round(((current - previous) / previous) * 100);
}

export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

export function fmtHours(h: number | null): string {
  if (h === null) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${Math.round(h * 10) / 10} h`;
  return `${Math.round((h / 24) * 10) / 10} d`;
}
