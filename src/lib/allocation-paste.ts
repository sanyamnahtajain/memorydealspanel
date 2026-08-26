import { z } from "zod";

import { objectIdSchema } from "@/lib/schemas/shared";
import { MAX_CUSTOM_MODEL_NAME, MAX_QTY_PER_LINE } from "@/lib/schemas/cart";

/**
 * Paste-a-list parsing + fuzzy model matching for the allocation builder.
 *
 * A shopkeeper ordering "1000 pcs across 100 models" already HAS the list —
 * in WhatsApp, a notebook photo, an old invoice. This module turns pasted
 * lines like
 *
 *     S23 Ultra 20
 *     iPhone 15 - 30
 *     redmi note 13: 50
 *     Pixel 8 x20
 *
 * into { name, qty } pairs and matches the names against the DeviceModel
 * master, case- and punctuation-insensitively. PURE — the server action
 * (src/server/actions/allocation-paste.ts) supplies the candidate models and
 * runs the match; unit tests exercise it directly.
 */

/** Hard cap on lines processed per paste — beyond it lines are counted, not read. */
export const MAX_PASTE_LINES = 500;

/** Input contract of the paste-matching server action (schemas live here —
 * a "use server" module may only export async functions). */
export const matchBreakdownPasteSchema = z.object({
  productId: objectIdSchema,
  text: z.string().min(1).max(20_000),
});
export type MatchBreakdownPasteInput = z.infer<typeof matchBreakdownPasteSchema>;

/** Lowercase, strip punctuation to spaces, collapse whitespace. */
export function normalizeModelText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ParsedPasteLine {
  /** The name part as the buyer wrote it (trimmed). */
  name: string;
  qty: number;
}

export interface PasteParseResult {
  lines: ParsedPasteLine[];
  /** Non-empty lines we could not read a "name then quantity" from. */
  unreadable: string[];
  /** Lines beyond MAX_PASTE_LINES that were not processed at all. */
  overflow: number;
}

/**
 * One line = model name, then quantity. Tolerates the separators people
 * actually type: spaces, "-", ":", "=", ",", "*" and an "x20"-style prefix
 * glued to the digits, plus a trailing "pcs"/"pc"/"units" word.
 */
const LINE_RE =
  /^(.+?)[\s\-–—:=,*]+(?:[x×](?=\d))?(\d{1,6})\s*(?:pcs?|pieces?|units?)?\s*$/iu;

export function parsePasteText(text: string): PasteParseResult {
  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");

  const overflow = Math.max(0, rawLines.length - MAX_PASTE_LINES);
  const lines: ParsedPasteLine[] = [];
  const unreadable: string[] = [];

  for (const raw of rawLines.slice(0, MAX_PASTE_LINES)) {
    const m = LINE_RE.exec(raw);
    const name = m?.[1]?.trim() ?? "";
    const qty = m ? Number(m[2]) : NaN;
    if (!m || name === "" || normalizeModelText(name) === "") {
      unreadable.push(raw);
      continue;
    }
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) {
      unreadable.push(raw);
      continue;
    }
    lines.push({ name, qty });
  }

  return { lines, unreadable, overflow };
}

export interface PasteCandidate {
  id: string;
  name: string;
}

export interface PasteMatchRow {
  /** Master-list model id, or NULL for a custom (typed) line. */
  modelId: string | null;
  /** True when the name matched no master model — the line is kept as typed. */
  custom?: true;
  name: string;
  qty: number;
}

export interface PasteMatchResult {
  rows: PasteMatchRow[];
  /**
   * Name texts (as written) that matched no master model. They are NOT
   * errors any more — each also appears in `rows` as a custom line — but the
   * preview calls them out ("not in master list — will be added as typed").
   */
  addedAsTyped: string[];
  unreadable: string[];
  overflow: number;
}

/**
 * Match ONE normalized name against the candidates:
 *   1. exact normalized equality;
 *   2. a candidate whose name CONTAINS the input — shortest wins ("s23 ultra"
 *      → "Galaxy S23 Ultra", not "Galaxy S23 Ultra 5G Special Edition");
 *   3. an input that contains a candidate name — longest (most specific) wins.
 * Ties break alphabetically so the result is deterministic.
 */
function matchOne(
  needle: string,
  candidates: readonly { id: string; name: string; norm: string }[],
): { id: string; name: string } | null {
  if (needle === "") return null;
  let contains: { id: string; name: string; norm: string } | null = null;
  let within: { id: string; name: string; norm: string } | null = null;
  for (const c of candidates) {
    if (c.norm === needle) return { id: c.id, name: c.name };
    if (c.norm.includes(needle)) {
      if (
        !contains ||
        c.norm.length < contains.norm.length ||
        (c.norm.length === contains.norm.length && c.norm < contains.norm)
      ) {
        contains = c;
      }
    } else if (needle.includes(c.norm)) {
      if (
        !within ||
        c.norm.length > within.norm.length ||
        (c.norm.length === within.norm.length && c.norm < within.norm)
      ) {
        within = c;
      }
    }
  }
  const hit = contains ?? within;
  return hit ? { id: hit.id, name: hit.name } : null;
}

/**
 * Parse a pasted list and resolve every line against the candidate models.
 * Repeated mentions of the same model SUM their quantities. A line whose name
 * matches NO candidate becomes a CUSTOM (typed) row instead of an error —
 * the master list is never complete, and a wholesale buyer must still be able
 * to order "their" model. Custom rows merge case-/punctuation-insensitively
 * on the typed name. Never throws.
 */
export function matchPasteText(
  text: string,
  candidates: readonly PasteCandidate[],
): PasteMatchResult {
  const parsed = parsePasteText(text);
  const pool = candidates.map((c) => ({
    id: c.id,
    name: c.name,
    norm: normalizeModelText(c.name),
  }));

  // Keyed by model id for master rows, by `custom:<norm>` for typed rows.
  const byKey = new Map<string, PasteMatchRow>();
  const order: string[] = [];
  const addedAsTyped: string[] = [];

  for (const line of parsed.lines) {
    const norm = normalizeModelText(line.name);
    const hit = matchOne(norm, pool);
    // Custom names follow the same sanitising as the cart schema: collapse
    // whitespace (parsePasteText already trimmed) and cap the length.
    const typedName = line.name.replace(/\s+/g, " ").slice(0, MAX_CUSTOM_MODEL_NAME).trim();
    const key = hit ? hit.id : `custom:${norm}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.qty = Math.min(existing.qty + line.qty, MAX_QTY_PER_LINE);
    } else if (hit) {
      byKey.set(key, { modelId: hit.id, name: hit.name, qty: line.qty });
      order.push(key);
    } else {
      byKey.set(key, {
        modelId: null,
        custom: true,
        name: typedName,
        qty: line.qty,
      });
      order.push(key);
      addedAsTyped.push(line.name);
    }
  }

  return {
    rows: order.map((key) => byKey.get(key)!),
    addedAsTyped,
    unreadable: parsed.unreadable,
    overflow: parsed.overflow,
  };
}
