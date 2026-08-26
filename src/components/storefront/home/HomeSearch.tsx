"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowRight } from "lucide-react";

/**
 * HomeSearch — the first thing on the home page. Retailers open the app to
 * FIND things, so the search field owns the first thumb-reach position.
 *
 * Extracted from the removed hero: just the search form and the category
 * suggestion chips, none of the marketing chrome. Submits to /search?q= via
 * the router (SPA nav) with a plain <form action="/search" method="get">
 * fallback so it works before hydration.
 *
 * ISR-SAFE: `suggestions` are category names passed from the server render —
 * global catalog data, identical for every visitor. Nothing here reads a
 * viewer or a price.
 */
export function HomeSearch({
  suggestions = [],
}: {
  suggestions?: string[];
}) {
  const router = useRouter();
  const [value, setValue] = React.useState("");

  function go(q: string) {
    const trimmed = q.trim();
    router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search");
  }

  return (
    <div>
      <form
        action="/search"
        method="get"
        onSubmit={(e) => {
          e.preventDefault();
          go(value);
        }}
        role="search"
        className="group flex items-center gap-2 rounded-full border border-border bg-card py-1.5 pr-1.5 pl-4 shadow-sm ring-1 ring-foreground/5 transition-shadow focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40"
      >
        <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <input
          type="search"
          name="q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search chargers, cables, power banks, brands…"
          aria-label="Search the catalogue"
          className="min-w-0 flex-1 bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground md:text-base"
        />
        <button
          type="submit"
          aria-label="Search"
          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none transition-[background-color,transform] hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95"
        >
          <span className="hidden sm:inline">Search</span>
          <ArrowRight className="size-4 sm:hidden" aria-hidden />
        </button>
      </form>

      {suggestions.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">Popular:</span>
          {suggestions.slice(0, 5).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => go(s)}
              className="rounded-full border border-border bg-card px-2.5 py-1 font-medium text-foreground/80 outline-none transition-colors hover:border-primary/40 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
