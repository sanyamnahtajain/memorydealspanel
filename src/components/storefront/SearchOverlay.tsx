"use client";

/**
 * SearchOverlay — the instant-search launcher.
 *
 * - Phones: a full-viewport sheet that springs up over the storefront.
 *   Desktop: a command-palette style panel floating over a blurred backdrop
 *   (click outside or Esc closes). Both respect reduced motion and are
 *   focus-trapped.
 * - Debounced type-ahead calls the `searchSuggestions` server action, which
 *   returns PRICE-FREE suggestions (id/name/brand/thumb only) — no money ever
 *   reaches this client component regardless of viewer. Live, viewer-aware
 *   pricing lives only on the `/search` results page.
 * - Recent searches persist in localStorage and render as CHIPS; category
 *   quick-chips seed common queries; matched substrings are highlighted.
 * - Keyboard: Esc closes, ↑/↓ move a highlight through the current rows
 *   (recent chips when empty, results when typing), Enter activates the
 *   highlighted row or submits the raw query. Tab cycles inside the surface.
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
  ArrowUpRight,
  Clock,
  CornerDownLeft,
  ImageOff,
  Loader2,
  Search as SearchIcon,
  Sparkles,
  X,
} from "lucide-react";

import { searchSuggestions } from "@/app/(storefront)/search/actions";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/display-case";
import { hapticTap } from "@/lib/haptics";
import { useEntranceInitial } from "@/components/motion/useEntrance";
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

const PANEL_SPRING = { type: "spring", stiffness: 420, damping: 36, mass: 0.8 } as const;

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
  const listRef = React.useRef<HTMLElement>(null);
  const reqId = React.useRef(0);

  const panelInitial = useEntranceInitial({ opacity: 0, y: 18, scale: 0.985 });

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

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="search-overlay"
          initial={reducedMotion ? undefined : { opacity: 0 }}
          animate={reducedMotion ? undefined : { opacity: 1 }}
          exit={reducedMotion ? undefined : { opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex flex-col md:items-center md:bg-foreground/30 md:px-6 md:pt-[8vh] md:backdrop-blur-sm"
        >
          {/* Desktop: click the backdrop to close. */}
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close search"
            onClick={onClose}
            className="absolute inset-0 hidden cursor-default md:block"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Search products"
            ref={surfaceRef}
            onKeyDown={onKeyDown}
            onKeyDownCapture={onKeyDownCapture}
            initial={panelInitial}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.985 }}
            transition={reducedMotion ? { duration: 0.12 } : PANEL_SPRING}
            className={cn(
              "relative flex min-h-0 flex-1 flex-col bg-background pt-[env(safe-area-inset-top)]",
              "md:max-h-[76vh] md:w-full md:max-w-2xl md:flex-none md:overflow-hidden md:rounded-3xl md:pt-0 md:shadow-[0_30px_80px_-30px_rgb(0_0_0/0.45)] md:ring-1 md:ring-foreground/10",
            )}
          >
            {/* Search bar */}
            <div className="flex items-center gap-2 px-4 pt-3 pb-2 md:px-4 md:pt-4">
              <div className="relative flex flex-1 items-center">
                <SearchIcon
                  className="pointer-events-none absolute left-4 size-5 text-muted-foreground"
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
                  className="h-12 w-full rounded-2xl bg-muted/70 pr-11 pl-12 text-base text-foreground outline-none ring-1 ring-foreground/5 transition-[box-shadow,background-color] placeholder:text-muted-foreground/80 focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-ring/50 md:h-14 md:text-lg [&::-webkit-search-cancel-button]:hidden"
                />
                {loading ? (
                  <Loader2
                    className="absolute right-4 size-4.5 animate-spin text-muted-foreground"
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
                    className="absolute right-2.5 inline-flex size-8 items-center justify-center rounded-full bg-foreground/8 text-foreground outline-none transition-colors hover:bg-foreground/12 focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm font-semibold text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] md:hidden"
              >
                Cancel
              </button>
            </div>

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-6 md:pb-4">
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
                <div className="flex flex-col items-center px-6 pt-14 text-center md:pt-10">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                    <SearchIcon className="size-5" aria-hidden />
                  </span>
                  <p className="mt-4 font-heading text-base font-semibold tracking-tight text-foreground">
                    No matches for “{trimmed}”
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Try a shorter keyword or a brand name.
                  </p>
                  <button
                    type="button"
                    onClick={() => submit(query)}
                    className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-semibold text-background outline-none transition-colors hover:bg-foreground/90 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]"
                  >
                    Search the full catalogue
                    <ArrowRight className="size-4" aria-hidden />
                  </button>
                </div>
              ) : (
                <div>
                  <p className="mb-2 px-1 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                    Products
                  </p>
                  <ul
                    ref={listRef as React.RefObject<HTMLUListElement | null>}
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
                          onClick={() => {
                            hapticTap();
                            openProduct(r);
                          }}
                          className={cn(
                            "group flex min-h-14 w-full items-center gap-3 rounded-2xl px-2 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99]",
                            activeRow === i ? "bg-muted" : "hover:bg-muted/70",
                          )}
                        >
                          <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted/70 p-1 ring-1 ring-foreground/5">
                            {r.thumbUrl ? (
                              <Image
                                src={r.thumbUrl}
                                alt=""
                                fill
                                sizes="48px"
                                className="object-contain p-1 mix-blend-multiply"
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
                                {highlight(titleCase(r.brand), trimmed)}
                              </span>
                            ) : null}
                          </span>
                          <ArrowUpRight
                            className={cn(
                              "size-4 shrink-0 text-muted-foreground transition-[transform,opacity] duration-150",
                              activeRow === i
                                ? "translate-x-0 opacity-100"
                                : "-translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100",
                            )}
                            aria-hidden
                          />
                        </button>
                      </li>
                    ))}
                  </ul>

                  <button
                    type="button"
                    onClick={() => submit(query)}
                    className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-sm font-semibold text-background outline-none transition-colors hover:bg-foreground/90 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]"
                  >
                    See all results for “{trimmed}”
                    <ArrowRight className="size-4" aria-hidden />
                  </button>
                </div>
              )}
            </div>

            {/* Keyboard hint (desktop only) */}
            <div className="hidden items-center justify-center gap-4 border-t border-foreground/6 px-4 py-2 text-[11px] text-muted-foreground md:flex">
              <KeyHint keys={["↑", "↓"]} label="Navigate" />
              <KeyHint icon={<CornerDownLeft className="size-3" aria-hidden />} label="Select" />
              <KeyHint keys={["Esc"]} label="Close" />
            </div>
          </motion.div>
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
  listRef: React.RefObject<HTMLElement | null>;
  onPickRecent: (q: string) => void;
  onClearRecents: () => void;
  onClose: () => void;
}) {
  const hasRecents = recents.length > 0;
  const hasCategories = categories.length > 0;

  if (!hasRecents && !hasCategories) {
    return (
      <div className="flex flex-col items-center px-6 pt-14 text-center md:pt-10">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Sparkles className="size-5" aria-hidden />
        </span>
        <p className="mt-4 font-heading text-base font-semibold tracking-tight text-foreground">
          Search the catalogue
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Start typing a product name or brand.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      {hasRecents ? (
        <section>
          <div className="mb-2.5 flex items-center justify-between px-1">
            <h2 className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              Recent
            </h2>
            <button
              type="button"
              onClick={onClearRecents}
              className="inline-flex min-h-11 items-center rounded-full px-3 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-9"
            >
              Clear
            </button>
          </div>
          <div
            ref={listRef as React.RefObject<HTMLDivElement | null>}
            id="search-overlay-list"
            role="listbox"
            aria-label="Recent searches"
            className="flex flex-wrap gap-2"
          >
            {recents.map((r, i) => (
              <button
                key={r}
                type="button"
                id={`search-row-${i}`}
                data-row={i}
                role="option"
                aria-selected={active === i}
                onClick={() => {
                  hapticTap();
                  onPickRecent(r);
                }}
                className={cn(
                  "inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full px-3.5 text-sm font-medium outline-none ring-1 md:min-h-10 transition-[background-color,color,box-shadow,transform] duration-150 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]",
                  active === i
                    ? "bg-foreground text-background ring-foreground"
                    : "bg-card text-foreground ring-foreground/10 hover:bg-muted",
                )}
              >
                <Clock
                  className={cn(
                    "size-3.5 shrink-0",
                    active === i ? "text-background/70" : "text-muted-foreground",
                  )}
                  aria-hidden
                />
                <span className="truncate">{r}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {hasCategories ? (
        <section>
          <h2 className="mb-2.5 px-1 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            Browse categories
          </h2>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <Link
                key={c.slug}
                href={`/c/${c.slug}`}
                onClick={() => {
                  hapticTap();
                  onClose();
                }}
                className="inline-flex min-h-11 items-center gap-1 rounded-full bg-card px-3.5 text-sm font-medium text-foreground outline-none ring-1 ring-foreground/10 transition-[background-color,transform] duration-150 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] md:min-h-10"
              >
                {titleCase(c.name)}
                <ArrowUpRight className="size-3.5 text-muted-foreground" aria-hidden />
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
          <span className="size-12 shrink-0 animate-pulse rounded-xl bg-muted" />
          <span className="flex-1 space-y-2">
            <span className="block h-3.5 w-2/3 animate-pulse rounded-full bg-muted" />
            <span className="block h-3 w-1/3 animate-pulse rounded-full bg-muted" />
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
        <kbd className="inline-flex min-w-5 items-center justify-center rounded-md bg-muted px-1 py-0.5 text-[10px] font-medium text-foreground ring-1 ring-foreground/8">
          {icon}
        </kbd>
      ) : (
        keys?.map((k) => (
          <kbd
            key={k}
            className="inline-flex min-w-5 items-center justify-center rounded-md bg-muted px-1 py-0.5 text-[10px] font-medium text-foreground ring-1 ring-foreground/8"
          >
            {k}
          </kbd>
        ))
      )}
      <span>{label}</span>
    </span>
  );
}
