"use client";

/**
 * SearchLauncher — the persistent search pill on /search that opens the
 * {@link SearchOverlay}. Purely presentational glue; carries no pricing.
 * Keeps the overlay's open state and forwards the current query and category
 * chips into it.
 *
 * Reads as a launcher, not a form: a soft pill with the glyph in its own
 * disc, the current query (or hint) and, on desktop, the ⌘K shortcut.
 */

import * as React from "react";
import { Search as SearchIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { hapticTap } from "@/lib/haptics";
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
  className?: string;
}

export function SearchLauncher({
  query,
  categories,
  autoOpen = false,
  className,
}: SearchLauncherProps) {
  const [open, setOpen] = React.useState(autoOpen);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          hapticTap();
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "group flex min-h-13 w-full items-center gap-3 rounded-full bg-card py-1.5 pr-4 pl-1.5 text-left text-sm shadow-sm ring-1 ring-foreground/8 outline-none transition-[box-shadow,transform,background-color] duration-200 hover:shadow-md hover:ring-foreground/12 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99]",
          className,
        )}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform duration-200 group-hover:scale-105">
          <SearchIcon className="size-4.5" aria-hidden />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            query ? "font-medium text-foreground" : "text-muted-foreground",
          )}
        >
          {query ? query : "Search products, brands…"}
        </span>
        <kbd className="hidden shrink-0 items-center gap-0.5 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-foreground/8 md:inline-flex">
          ⌘K
        </kbd>
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
