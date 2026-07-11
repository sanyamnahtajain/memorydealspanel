"use client";

import * as React from "react";
import Link from "next/link";
import { Search } from "lucide-react";

import type { BrandWithCount } from "@/server/dal/brands";

/**
 * Full brand directory for `/brands` — a searchable, responsive grid of brand
 * tiles (logo or monogram + product count) linking to each brand landing page.
 * Client-side filter keeps a large brand list (dozens) easy to scan. Price-free.
 */
export function BrandDirectory({ brands }: { brands: BrandWithCount[] }) {
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const filtered = q
    ? brands.filter((b) => b.name.toLowerCase().includes(q))
    : brands;

  return (
    <div>
      <div className="relative mb-6 max-w-sm">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${brands.length} brands…`}
          aria-label="Search brands"
          className="w-full rounded-full border border-border bg-background py-2.5 pr-4 pl-9 text-sm text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No brands match &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 md:gap-4 lg:grid-cols-5">
          {filtered.map((brand) => (
            <Link
              key={brand.id}
              href={`/b/${brand.slug}`}
              className="group flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card p-4 text-center outline-none transition-all hover:border-primary/40 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]"
            >
              <span className="flex h-12 w-full items-center justify-center">
                {brand.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- brand logos are arbitrary-ratio; object-contain is simplest
                  <img
                    src={brand.logo}
                    alt={brand.name}
                    className="max-h-12 w-auto max-w-[85%] object-contain"
                    loading="lazy"
                  />
                ) : (
                  <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 font-heading text-lg font-bold text-primary">
                    {brand.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </span>
              <span className="w-full truncate text-sm font-semibold text-foreground">
                {brand.name}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {brand.count} {brand.count === 1 ? "product" : "products"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
