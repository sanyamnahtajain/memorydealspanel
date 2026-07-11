"use server";

import { resolveViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import {
  cities as citiesService,
  specKeys as specKeysService,
  specValues as specValuesService,
} from "@/server/services/suggestions";

/**
 * "use server" wrappers for the autocomplete suggestion service.
 *
 * REMEMBER: a "use server" module may export ONLY async functions, so all the
 * shared types/helpers below are declared inline and every export is async.
 *
 * AUTHORIZATION / DATA-LEAK POLICY:
 *   - Spec keys & values come from the product catalogue but are only useful
 *     inside the admin product editor, and product data can carry
 *     not-yet-published rows — so both are ADMIN-ONLY.
 *   - Cities: the admin customer directory must never be exposed to anonymous
 *     visitors. `citiesAction` returns DISTINCT customer cities and is
 *     therefore ADMIN-ONLY too. The PUBLIC access-request form must instead use
 *     the static curated list shipped client-side in `CityField` — it never
 *     calls this action, so the customer roster can't leak.
 *
 * All actions:
 *   - never throw across the client boundary (return a typed result),
 *   - accept an optional `query` and rank/limit server-side so the client
 *     receives a already-bounded list (the Combobox still filters locally),
 *   - are safe under keystroke bursts because the service caches results.
 */

/** Discriminated result — callers switch on `.ok`, never catch a throw. */
type SuggestResult =
  | { ok: true; values: string[] }
  | { ok: false; error: string };

/** How many ranked matches to hand back to the client per request. */
const MAX_RETURNED = 50;

/**
 * Ranks `values` against a free-text `query`: case-insensitive, prefix matches
 * first, then substring matches, preserving the service's alphabetical order
 * within each tier. An empty query returns the head of the (already sorted)
 * list. Pure + synchronous, but declared inside this "use server" module as a
 * local (non-exported) helper so the file exports only async functions.
 */
function rankByQuery(values: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q === "") return values.slice(0, MAX_RETURNED);
  const prefix: string[] = [];
  const contains: string[] = [];
  for (const v of values) {
    const lower = v.toLowerCase();
    if (lower.startsWith(q)) prefix.push(v);
    else if (lower.includes(q)) contains.push(v);
  }
  return [...prefix, ...contains].slice(0, MAX_RETURNED);
}

/** Resolves the viewer and confirms admin; returns a typed error otherwise. */
async function assertAdmin(): Promise<{ ok: true } | SuggestResult> {
  const viewer = await resolveViewer();
  if (!isAdmin(viewer)) {
    return { ok: false, error: "You must be signed in as an admin." };
  }
  return { ok: true };
}

/**
 * Distinct spec KEYS across products, ranked against `query`. Admin-only.
 */
export async function specKeysAction(query = ""): Promise<SuggestResult> {
  const auth = await assertAdmin();
  if (!auth.ok) return auth;
  try {
    const keys = await specKeysService();
    return { ok: true, values: rankByQuery(keys, query) };
  } catch {
    return { ok: false, error: "Could not load spec suggestions." };
  }
}

/**
 * Distinct VALUES used for `key`, ranked against `query`. Admin-only. A blank
 * key yields an empty list (no value suggestions until a key is chosen).
 */
export async function specValuesAction(
  key: string,
  query = "",
): Promise<SuggestResult> {
  const auth = await assertAdmin();
  if (!auth.ok) return auth;
  if (!key || key.trim() === "") {
    return { ok: true, values: [] };
  }
  try {
    const values = await specValuesService(key);
    return { ok: true, values: rankByQuery(values, query) };
  } catch {
    return { ok: false, error: "Could not load value suggestions." };
  }
}

/**
 * Distinct customer CITIES, ranked against `query`. ADMIN-ONLY — the public
 * request form uses the static curated list in `CityField` instead, so this
 * never exposes the customer roster to anonymous visitors.
 */
export async function citiesAction(query = ""): Promise<SuggestResult> {
  const auth = await assertAdmin();
  if (!auth.ok) return auth;
  try {
    const list = await citiesService();
    return { ok: true, values: rankByQuery(list, query) };
  } catch {
    return { ok: false, error: "Could not load city suggestions." };
  }
}
