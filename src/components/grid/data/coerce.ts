/**
 * Value coercion helpers shared by the clipboard, fill and bulk engines.
 *
 * The grid stores values in their canonical at-rest form (currency = integer
 * PAISE, toggles = booleans, multi-tag = string[]). Incoming text — from a
 * TSV paste, a filled series, or a bulk edit — must be coerced to that form
 * per the target column's {@link CellType}. Coercion never throws; it returns
 * a discriminated result so callers can decide whether to write or skip.
 */

import { parseRupees } from "@/lib/money";
import type { CellType, ColumnDef, GridRow } from "@/components/grid/types";

/** Outcome of coercing a raw string toward a column's canonical value. */
export type CoerceResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: string };

const TRUE_TOKENS = new Set(["true", "1", "yes", "y", "on", "✓", "x"]);
const FALSE_TOKENS = new Set(["false", "0", "no", "n", "off", "", "-"]);

/**
 * Coerce a raw string (as it would appear in a spreadsheet cell) into the
 * canonical stored value for `type`. For `select`/`multi-tag` the `options`
 * are consulted so labels and values both resolve. Read-only/`computed`
 * columns always fail.
 */
export function coerceCellValue(
  raw: string,
  type: CellType,
  options?: ColumnDef["options"],
): CoerceResult {
  const text = raw.trim();

  switch (type) {
    case "computed":
      return { ok: false, reason: "computed columns are read-only" };

    case "text":
    case "image":
      return { ok: true, value: raw };

    case "number": {
      if (text === "") return { ok: true, value: null };
      const n = Number(text.replace(/,/g, ""));
      if (!Number.isFinite(n)) {
        return { ok: false, reason: `"${raw}" is not a number` };
      }
      return { ok: true, value: n };
    }

    case "percent": {
      if (text === "") return { ok: true, value: null };
      const n = Number(text.replace(/%/g, "").trim());
      if (!Number.isFinite(n)) {
        return { ok: false, reason: `"${raw}" is not a percentage` };
      }
      return { ok: true, value: n };
    }

    case "currency": {
      if (text === "") return { ok: true, value: null };
      const paise = parseRupees(text);
      if (paise === null) {
        return { ok: false, reason: `"${raw}" is not a rupee amount` };
      }
      return { ok: true, value: paise };
    }

    case "toggle": {
      const lower = text.toLowerCase();
      if (TRUE_TOKENS.has(lower)) return { ok: true, value: true };
      if (FALSE_TOKENS.has(lower)) return { ok: true, value: false };
      return { ok: false, reason: `"${raw}" is not a boolean` };
    }

    case "select": {
      if (text === "") return { ok: true, value: null };
      const match = matchOption(text, options);
      if (!match) {
        return { ok: false, reason: `"${raw}" is not a valid option` };
      }
      return { ok: true, value: match };
    }

    case "multi-tag": {
      if (text === "") return { ok: true, value: [] };
      const parts = text
        .split(/[,;]/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      const resolved: string[] = [];
      for (const part of parts) {
        const match = matchOption(part, options);
        // Unknown tags are kept verbatim so free-form tag columns still work.
        resolved.push(match ?? part);
      }
      return { ok: true, value: dedupe(resolved) };
    }

    default: {
      // Exhaustiveness guard — every CellType handled above.
      const _never: never = type;
      return { ok: false, reason: `unsupported cell type ${String(_never)}` };
    }
  }
}

/** Resolve a token against a column's options by value first, then by label. */
function matchOption(
  token: string,
  options?: ColumnDef["options"],
): string | null {
  if (!options || options.length === 0) return token;
  const lower = token.toLowerCase();
  const byValue = options.find((o) => o.value.toLowerCase() === lower);
  if (byValue) return byValue.value;
  const byLabel = options.find((o) => o.label.toLowerCase() === lower);
  return byLabel ? byLabel.value : null;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

/**
 * Render a stored canonical value back to the plain string a spreadsheet cell
 * would contain. Prefers a column's `format`, but for currency deliberately
 * emits a bare rupee number (no ₹, no grouping) so the round-trip
 * serialize → parse is lossless.
 */
export function stringifyCellValue(
  value: unknown,
  type: CellType,
  column?: ColumnDef,
): string {
  if (value === null || value === undefined) return "";

  switch (type) {
    case "currency": {
      if (typeof value !== "number") return "";
      const rupees = Math.trunc(value / 100);
      const paise = Math.abs(value % 100);
      return paise === 0
        ? String(rupees)
        : `${rupees}.${String(paise).padStart(2, "0")}`;
    }
    case "multi-tag": {
      if (Array.isArray(value)) return value.join(", ");
      return String(value);
    }
    case "toggle":
      return value ? "true" : "false";
    case "select": {
      const opt = column?.options?.find((o) => o.value === value);
      return opt ? opt.value : String(value);
    }
    default:
      return String(value);
  }
}

/** Cell types whose stored value is a number and support arithmetic series. */
export function isNumericType(type: CellType): boolean {
  return type === "number" || type === "currency" || type === "percent";
}

/** Reference to a row's field value by column, guarding for missing rows. */
export function readCell<Row extends GridRow>(
  row: Row | undefined,
  col: ColumnDef<Row>,
): unknown {
  if (!row) return undefined;
  return row[col.key];
}
