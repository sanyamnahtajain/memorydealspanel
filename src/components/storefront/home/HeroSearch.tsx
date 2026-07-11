"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowRight } from "lucide-react";

/**
 * The hero search bar — a catalog's primary "find it" affordance. Submits to
 * /search?q= via the router (SPA nav) with a plain <form action="/search">
 * fallback so it works before hydration. Token-styled, large touch target.
 */
export function HeroSearch({
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
    <div className="mt-6">
      <form
        action="/search"
        method="get"
        onSubmit={(e) => {
          e.preventDefault();
          go(value);
        }}
        role="search"
        className="group flex items-center gap-2 rounded-full border border-border bg-background/90 py-1.5 pr-1.5 pl-4 shadow-sm backdrop-blur transition-shadow focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40"
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
              className="rounded-full border border-border bg-background/60 px-2.5 py-1 font-medium text-foreground/80 transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
