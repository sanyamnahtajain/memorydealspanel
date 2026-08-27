"use client";

import {
  CONTEXT_SLICES,
  slicesParam,
  type ContextSlice,
} from "@/lib/viewer-context";
import type {
  ContextBuyAgainItem,
  ContextLastOrder,
} from "@/app/api/me/context/route";
import type { AccessStatusSnapshot } from "@/components/access/useAccessStatus";

/**
 * ONE per-viewer request per page load, shared by every consumer.
 *
 * WHY: the storefront used to fan out to four separate endpoints on a single
 * page load (access status, last order, buy again, price labels). Vercel bills
 * each of those three ways at once — invocation, Fluid CPU, and the
 * observability events it emits — so the home page cost six invocations to
 * render one screen.
 *
 * HOW THE BATCHING IS SAFE: consumers register what they need from inside
 * their own mount effects, and the actual fetch is deferred by a MICROTASK.
 * React flushes all of a commit's effects synchronously in one pass, so a
 * microtask queued during the first effect runs only after the last one has
 * registered — every consumer on the page lands in the same request. If a
 * later commit registers something new (a slice that mounts after a Suspense
 * boundary resolves), it simply schedules a second, smaller request rather
 * than being lost.
 *
 * This module holds NO entitlement logic and never sees a raw price. The
 * server decides what a viewer may see; money arrives pre-formatted or not
 * at all. Every failure resolves to empty state, so a network error renders
 * the anonymous page instead of breaking it.
 */

export interface ViewerContextPayload {
  access: AccessStatusSnapshot | null;
  lastOrder: ContextLastOrder | null;
  buyAgain: ContextBuyAgainItem[];
  priceLabels: Record<string, string>;
}

const EMPTY: ViewerContextPayload = {
  access: null,
  lastOrder: null,
  buyAgain: [],
  priceLabels: {},
};

let payload: ViewerContextPayload = EMPTY;
/** Slices already requested (or in flight) — never asked for twice. */
let fetchedSlices = new Set<ContextSlice>();
/** Product ids already requested — never asked for twice. */
let fetchedIds = new Set<string>();
/** Registered but not yet sent. */
let pendingSlices = new Set<ContextSlice>();
let pendingIds = new Set<string>();
let scheduled = false;

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getViewerContext(): ViewerContextPayload {
  return payload;
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  // See the header: a microtask lands after every effect in this commit.
  queueMicrotask(() => {
    scheduled = false;
    void run();
  });
}

async function run(): Promise<void> {
  const slices = [...pendingSlices];
  const ids = [...pendingIds];
  if (slices.length === 0 && ids.length === 0) return;

  pendingSlices = new Set();
  pendingIds = new Set();
  for (const slice of slices) fetchedSlices.add(slice);
  for (const id of ids) fetchedIds.add(id);

  const params = new URLSearchParams();
  if (slices.length > 0) params.set("want", slicesParam(slices));
  if (ids.length > 0) params.set("ids", ids.join(","));

  try {
    const res = await fetch(`/api/me/context?${params.toString()}`, {
      credentials: "same-origin",
    });
    if (!res.ok) return;
    const json = (await res.json()) as Partial<ViewerContextPayload> | null;
    if (!json) return;

    // MERGE, never replace: a later request for one slice must not blank the
    // slices an earlier request already filled.
    payload = {
      access:
        json.access && typeof json.access.signedIn === "boolean"
          ? json.access
          : payload.access,
      lastOrder: json.lastOrder ?? payload.lastOrder,
      buyAgain:
        Array.isArray(json.buyAgain) && json.buyAgain.length > 0
          ? json.buyAgain
          : payload.buyAgain,
      priceLabels: { ...payload.priceLabels, ...(json.priceLabels ?? {}) },
    };
    notify();
  } catch {
    // Render the anonymous page rather than breaking it. Allow a retry on a
    // later mount by forgetting what we claimed to have fetched.
    for (const slice of slices) fetchedSlices.delete(slice);
    for (const id of ids) fetchedIds.delete(id);
  }
}

/** Ask for a slice. Idempotent — the second caller costs nothing. */
export function needSlice(slice: ContextSlice): void {
  if (fetchedSlices.has(slice) || pendingSlices.has(slice)) return;
  pendingSlices.add(slice);
  schedule();
}

/** Ask for one product's price label. Idempotent per id. */
export function needPriceLabel(productId: string): void {
  if (fetchedIds.has(productId) || pendingIds.has(productId)) return;
  pendingIds.add(productId);
  // The ids ride along with the priceLabels slice.
  if (
    !fetchedSlices.has(CONTEXT_SLICES.priceLabels) &&
    !pendingSlices.has(CONTEXT_SLICES.priceLabels)
  ) {
    pendingSlices.add(CONTEXT_SLICES.priceLabels);
  }
  schedule();
}

/**
 * Drop everything and refetch what was previously asked for. Called after an
 * access request succeeds so every mounted consumer repaints from new truth.
 */
export function refreshViewerContext(): void {
  const slices = [...fetchedSlices];
  const ids = [...fetchedIds];
  payload = EMPTY;
  fetchedSlices = new Set();
  fetchedIds = new Set();
  notify();
  for (const slice of slices) needSlice(slice);
  for (const id of ids) needPriceLabel(id);
}
