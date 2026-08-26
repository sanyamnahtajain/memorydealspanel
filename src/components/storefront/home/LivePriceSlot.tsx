"use client";

/**
 * LivePriceSlot / HomePriceReveal — client-side price upgrade for the PUBLIC
 * ISR home rails (Best sellers, Trending now).
 *
 * THE PROBLEM: home is a cached public shell (revalidate=300) whose rails are
 * server-rendered with ANON locked pills — correct for the cache, wrong to
 * leave standing for an approved customer looking at their own home screen.
 *
 * THE PATTERN (same contract as BuyAgainRail): the server-rendered anon pill
 * is the CHILDREN of each <LivePriceSlot>; after hydration the leaves register
 * their product ids with the surrounding <HomePriceReveal>, which makes ONE
 * batched fetch to /api/price-labels. Entitlement is resolved server-side in
 * that route — an unentitled viewer gets `{}` back and the anon pills simply
 * never change, so the logged-out experience is pixel-identical to the cached
 * shell. An entitled viewer's pills swap to the real label.
 *
 * PRICE-GATE CONTRACT: nothing in this file computes entitlement or handles a
 * raw money number — labels arrive pre-formatted ("₹1,299") or not at all.
 */

import * as React from "react";

type Labels = Record<string, string>;

interface RevealContextValue {
  register: (productId: string) => void;
  labels: Labels;
}

const RevealContext = React.createContext<RevealContextValue | null>(null);

function parseLabels(data: unknown): Labels {
  const labels = (data as { labels?: unknown } | null)?.labels;
  if (labels === null || typeof labels !== "object" || Array.isArray(labels)) {
    return {};
  }
  const out: Labels = {};
  for (const [id, label] of Object.entries(labels as Record<string, unknown>)) {
    if (typeof label === "string") out[id] = label;
  }
  return out;
}

export function HomePriceReveal({ children }: { children: React.ReactNode }) {
  const [labels, setLabels] = React.useState<Labels>({});
  // Leaves register during their mount effects — one commit, so React batches
  // every registration into a single state update and ONE fetch effect run.
  const [ids, setIds] = React.useState<readonly string[]>([]);
  const fetchedKey = React.useRef("");

  const register = React.useCallback((productId: string) => {
    setIds((prev) =>
      prev.includes(productId) ? prev : [...prev, productId],
    );
  }, []);

  const idsKey = ids.join(",");
  React.useEffect(() => {
    if (idsKey === "" || idsKey === fetchedKey.current) return;
    fetchedKey.current = idsKey;
    const controller = new AbortController();
    fetch(`/api/price-labels?ids=${idsKey}`, {
      signal: controller.signal,
      credentials: "same-origin",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const parsed = parseLabels(data);
        if (Object.keys(parsed).length > 0) setLabels(parsed);
      })
      .catch(() => {
        // Pills stay locked — a broken reveal must never break the home page.
      });
    return () => controller.abort();
  }, [idsKey]);

  const value = React.useMemo(() => ({ register, labels }), [register, labels]);
  return (
    <RevealContext.Provider value={value}>{children}</RevealContext.Provider>
  );
}

/**
 * Wraps one card's server-rendered anon price slot. Until (unless) a label
 * arrives for this product, it renders the children untouched — zero visual
 * difference from the pure server shell. With a label it renders the priced
 * pill (PricePill's default-variant look; the label is already formatted).
 */
export function LivePriceSlot({
  productId,
  children,
}: {
  productId: string;
  children: React.ReactNode;
}) {
  const ctx = React.useContext(RevealContext);
  const register = ctx?.register;

  React.useEffect(() => {
    register?.(productId);
  }, [register, productId]);

  const label = ctx?.labels[productId];
  if (!label) return <>{children}</>;

  return (
    <span
      data-slot="price-pill"
      data-variant="default"
      className="inline-flex h-6 w-fit shrink-0 items-center rounded-full border border-border bg-secondary px-2 font-tabular text-xs font-semibold text-secondary-foreground"
    >
      {label}
    </span>
  );
}
