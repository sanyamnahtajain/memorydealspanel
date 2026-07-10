"use client";

/**
 * SearchLauncher — the persistent search bar on /search that opens the
 * full-screen {@link SearchOverlay}. Purely presentational glue; carries no
 * pricing. Keeps the overlay's open state and forwards the current query and
 * category chips into it.
 */

import * as React from "react";
import { Search as SearchIcon } from "lucide-react";

import { SearchOverlay } from "@/components/storefront/SearchOverlay";

interface CategoryChip {
  name: string;
  slug: string;
}

interface SearchLauncherProps {
  query: string;
  categories: CategoryChip[];
  /** Open the overlay immediately on mount (e.g. empty /search landing). */
  autoOpen?: boolean;
}

export function SearchLauncher({
  query,
  categories,
  autoOpen = false,
}: SearchLauncherProps) {
  const [open, setOpen] = React.useState(autoOpen);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-12 w-full items-center gap-3 rounded-full border border-border bg-card px-4 text-left text-sm text-muted-foreground shadow-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <SearchIcon className="size-4 shrink-0" aria-hidden />
        <span className="truncate">
          {query ? query : "Search products, brands…"}
        </span>
      </button>

      <SearchOverlay
        open={open}
        onClose={() => setOpen(false)}
        initialQuery={query}
        categories={categories}
      />
    </>
  );
}
