"use client";

/**
 * SearchOverlay — full-screen instant search.
 *
 * - Opens as a full-viewport dialog over the storefront, animated in/out
 *   (respecting reduced-motion) and focus-trapped.
 * - Debounced type-ahead calls the `searchSuggestions` server action, which
 *   returns PRICE-FREE suggestions (id/name/brand/thumb only) — no money ever
 *   reaches this client component regardless of viewer. Live, viewer-aware
 *   pricing lives only on the `/search` results page.
 * - Recent searches persist in localStorage; category chips seed common
 *   queries; matched substrings are highlighted in results.
 * - Keyboard: Esc closes, ↑/↓ move a highlight through the current rows
 *   (recents when empty, results when typing), Enter activates the highlighted
 *   row or submits the raw query. Focus is trapped inside the surface.
 * - Submitting (Enter / result tap / "See all") navigates to /search?q=… for
 *   the full, viewer-aware results grid.
 */

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  Clock,
  CornerDownLeft,
  ImageOff,
  Loader2,
  Search as SearchIcon,
  X,
} from "lucide-react";

import { searchSuggestions } from "@/app/(storefront)/search/actions";
import { cn } from "@/lib/utils";
import {
  clearRecents as clearStoredRecents,
  loadRecents,
  pushRecent,
} from "@/components/storefront/search/recents";
import { highlight } from "@/components/storefront/search/highlight";
import type {
  CategoryChip,
  SearchSuggestion,
} from "@/components/storefront/search/types";

const DEBOUNCE_MS = 180;

/** Focusable elements considered by the focus trap, in DOM order. */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])';

interface SearchOverlayProps {
  open: boolean;
  onClose: () => void;
  /** Optional seed query (e.g. from the current /search?q=). */
  initialQuery?: string;
  /** Category chips shown when the query is empty. */
  categories?: CategoryChip[];
}

export function SearchOverlay({
  open,
  onClose,
  initialQuery = "",
  categories = [],
}: SearchOverlayProps) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [query, setQuery] = React.useState(initialQuery);
  const [results, setResults] = React.useState<SearchSuggestion[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [recents, setRecents] = React.useState<string[]>(loadRecents);
  const [active, setActive] = React.useState(-1);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const surfaceRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const reqId = React.useRef(0);

  const trimmed = query.trim();

  // The set of keyboard-navigable rows for the CURRENT view: results while
  // typing, recents while empty. Used by ↑/↓/Enter.
  const rowCount = trimmed.length === 0 ? recents.length : results.length;
  // Clamp the highlight so a stale index (from a set that just shrank) never
  // points past the current rows before the reset effect fires.
  const activeRow = active < rowCount ? active : -1;

  // Reset query + refresh recents + focus when (re)opened. State updates run
  // in a deferred timeout so nothing is set synchronously in the effect body.
  React.useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      setQuery(initialQuery);
      setRecents(loadRecents());
      setActive(-1);
      inputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open, initialQuery]);

  // Lock body scroll while open.
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Reset the active-row highlight whenever the navigable set changes. The
  // update is deferred to a microtask so it never runs synchronously in the
  // effect body (which would trigger a cascading render).
  React.useEffect(() => {
    const t = window.setTimeout(() => setActive(-1), 0);
    return () => window.clearTimeout(t);
  }, [trimmed, rowCount]);

  // Debounced instant search. All state mutation happens inside the timer
  // callback so nothing is set synchronously during the effect body.
  React.useEffect(() => {
    if (!open) return;
    if (trimmed.length === 0) {
      const id = ++reqId.current;
      const clear = window.setTimeout(() => {
        if (reqId.current === id) {
          setResults([]);
          setLoading(false);
        }
      }, 0);
      return () => window.clearTimeout(clear);
    }
    const id = ++reqId.current;
    const spin = window.setTimeout(() => {
      if (reqId.current === id) setLoading(true);
    }, 0);
    const handle = window.setTimeout(async () => {
      try {
        const rows = await searchSuggestions(trimmed);
        if (reqId.current === id) setResults(rows);
      } catch {
        if (reqId.current === id) setResults([]);
      } finally {
        if (reqId.current === id) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(spin);
      window.clearTimeout(handle);
    };
  }, [trimmed, open]);

  const submit = React.useCallback(
    (raw: string) => {
      const value = raw.trim();
      if (!value) return;
      setRecents(pushRecent(value));
      onClose();
      router.push(`/search?q=${encodeURIComponent(value)}`);
    },
    [onClose, router],
  );

  const openProduct = React.useCallback(
    (suggestion: SearchSuggestion) => {
      pushRecent(trimmed);
      onClose();
      router.push(`/p/${suggestion.slug}`);
    },
    [onClose, router, trimmed],
  );

  const clearRecents = React.useCallback(() => {
    clearStoredRecents();
    setRecents([]);
  }, []);

  // Keyboard: Esc / arrow nav / Enter. Bound to the surface so it works
  // wherever focus lands inside the trap (input or a row).
  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown" && rowCount > 0) {
        e.preventDefault();
        setActive((i) => (i + 1) % rowCount);
        return;
      }
      if (e.key === "ArrowUp" && rowCount > 0) {
        e.preventDefault();
        setActive((i) => (i <= 0 ? rowCount - 1 : i - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (activeRow >= 0) {
          if (trimmed.length === 0) {
            submit(recents[activeRow]);
          } else {
            openProduct(results[activeRow]);
          }
        } else {
          submit(query);
        }
      }
    },
    [
      activeRow,
      onClose,
      openProduct,
      query,
      recents,
      results,
      rowCount,
      submit,
      trimmed,
    ],
  );

  // Focus trap: keep Tab / Shift+Tab cycling within the surface.
  const onKeyDownCapture = React.useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const focusable = Array.from(
      surface.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  // Keep the highlighted row scrolled into view.
  React.useEffect(() => {
    if (activeRow < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-row="${activeRow}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeRow]);

  const surfaceMotion = reducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: 8 },
        transition: { type: "spring" as const, stiffness: 460, damping: 40, mass: 0.7 },
      };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="search-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Search products"
          ref={surfaceRef}
          onKeyDown={onKeyDown}
          onKeyDownCapture={onKeyDownCapture}
          initial={reducedMotion ? undefined : { opacity: 0 }}
          animate={reducedMotion ? undefined : { opacity: 1 }}
          exit={reducedMotion ? undefined : { opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)]"
        >
          {/* Search bar */}
          <motion.div {...surfaceMotion} className="flex flex-col">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <div className="relative flex flex-1 items-center">
                <SearchIcon
                  className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
                  aria-hidden
                />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  type="search"
                  enterKeyHint="search"
                  placeholder="Search products, brands…"
                  aria-label="Search products"
                  role="combobox"
                  aria-expanded={rowCount > 0}
                  aria-controls="search-overlay-list"
                  aria-activedescendant={
                    activeRow >= 0 ? `search-row-${activeRow}` : undefined
                  }
                  autoComplete="off"
                  className="h-11 w-full rounded-full border border-border bg-card pr-10 pl-9 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
                />
                {loading ? (
                  <Loader2
                    className="absolute right-3 size-4 animate-spin text-muted-foreground"
                    aria-hidden
                  />
                ) : trimmed.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      inputRef.current?.focus();
                    }}
                    aria-label="Clear search"
                    className="absolute right-2 inline-flex size-7 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Cancel
              </button>
            </div>
          </motion.div>

          {/* Body */}
          <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 py-4">
            {trimmed.length === 0 ? (
              <EmptyQueryPanel
                recents={recents}
                categories={categories}
                active={activeRow}
                listRef={listRef}
                onPickRecent={submit}
                onClearRecents={clearRecents}
                onClose={onClose}
              />
            ) : loading && results.length === 0 ? (
              <ResultsSkeleton />
            ) : results.length === 0 ? (
              <div className="pt-16 text-center">
                <p className="text-sm font-medium text-foreground">
                  No results for “{trimmed}”
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try a different keyword or brand.
                </p>
              </div>
            ) : (
              <div>
                <ul
                  ref={listRef}
                  id="search-overlay-list"
                  role="listbox"
                  aria-label="Search suggestions"
                  className="space-y-1"
                >
                  {results.map((r, i) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        id={`search-row-${i}`}
                        data-row={i}
                        role="option"
                        aria-selected={activeRow === i}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => openProduct(r)}
                        className={cn(
                          "flex min-h-14 w-full items-center gap-3 rounded-xl px-2 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                          activeRow === i ? "bg-muted" : "hover:bg-muted",
                        )}
                      >
                        <span className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
                          {r.thumbUrl ? (
                            <Image
                              src={r.thumbUrl}
                              alt=""
                              fill
                              sizes="44px"
                              className="object-cover"
                            />
                          ) : (
                            <ImageOff
                              className="size-4 text-muted-foreground"
                              aria-hidden
                            />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {highlight(r.name, trimmed)}
                          </span>
                          {r.brand ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {highlight(r.brand, trimmed)}
                            </span>
                          ) : null}
                        </span>
                        <ArrowRight
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      </button>
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  onClick={() => submit(query)}
                  className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  See all results for “{trimmed}”
                  <ArrowRight className="size-4" aria-hidden />
                </button>
              </div>
            )}
          </div>

          {/* Keyboard hint (desktop only) */}
          <div className="hidden items-center justify-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted-foreground md:flex">
            <KeyHint keys={["↑", "↓"]} label="Navigate" />
            <KeyHint icon={<CornerDownLeft className="size-3" aria-hidden />} label="Select" />
            <KeyHint keys={["Esc"]} label="Close" />
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function EmptyQueryPanel({
  recents,
  categories,
  active,
  listRef,
  onPickRecent,
  onClearRecents,
  onClose,
}: {
  recents: string[];
  categories: CategoryChip[];
  active: number;
  listRef: React.RefObject<HTMLUListElement | null>;
  onPickRecent: (q: string) => void;
  onClearRecents: () => void;
  onClose: () => void;
}) {
  const hasRecents = recents.length > 0;
  const hasCategories = categories.length > 0;

  if (!hasRecents && !hasCategories) {
    return (
      <div className="pt-16 text-center">
        <p className="text-sm font-medium text-foreground">
          Search the catalogue
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Start typing a product name or brand.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {hasRecents ? (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Recent
            </h2>
            <button
              type="button"
              onClick={onClearRecents}
              className="rounded-sm text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Clear
            </button>
          </div>
          <ul
            ref={listRef}
            id="search-overlay-list"
            role="listbox"
            aria-label="Recent searches"
            className="space-y-1"
          >
            {recents.map((r, i) => (
              <li key={r}>
                <button
                  type="button"
                  id={`search-row-${i}`}
                  data-row={i}
                  role="option"
                  aria-selected={active === i}
                  onClick={() => onPickRecent(r)}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left text-sm text-foreground outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                    active === i ? "bg-muted" : "hover:bg-muted",
                  )}
                >
                  <Clock
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="truncate">{r}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {hasCategories ? (
        <section>
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Browse categories
          </h2>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <Link
                key={c.slug}
                href={`/c/${c.slug}`}
                onClick={onClose}
                className="inline-flex min-h-9 items-center rounded-full border border-border bg-card px-3.5 text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <ul className="space-y-1" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="flex min-h-14 items-center gap-3 px-2">
          <span className="size-11 shrink-0 animate-pulse rounded-lg bg-muted" />
          <span className="flex-1 space-y-2">
            <span className="block h-3.5 w-2/3 animate-pulse rounded bg-muted" />
            <span className="block h-3 w-1/3 animate-pulse rounded bg-muted" />
          </span>
        </li>
      ))}
    </ul>
  );
}

function KeyHint({
  keys,
  icon,
  label,
}: {
  keys?: string[];
  icon?: React.ReactNode;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      {icon ? (
        <kbd className="inline-flex min-w-5 items-center justify-center rounded border border-border bg-muted px-1 py-0.5 text-[10px] font-medium text-foreground">
          {icon}
        </kbd>
      ) : (
        keys?.map((k) => (
          <kbd
            key={k}
            className="inline-flex min-w-5 items-center justify-center rounded border border-border bg-muted px-1 py-0.5 text-[10px] font-medium text-foreground"
          >
            {k}
          </kbd>
        ))
      )}
      <span>{label}</span>
    </span>
  );
}
