"use client";

/**
 * SearchOverlay — full-screen instant search.
 *
 * - Opens as a full-viewport dialog over the storefront.
 * - Debounced type-ahead calls the `searchSuggestions` server action, which
 *   returns PRICE-FREE suggestions (id/name/brand/thumb only) — no money ever
 *   reaches this client component regardless of viewer.
 * - Recent searches persist in localStorage; category chips seed common
 *   queries; matched substrings are highlighted in results.
 * - Submitting (Enter / result tap / "See all") navigates to /search?q=… for
 *   the full, viewer-aware results grid.
 */

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Clock,
  ImageOff,
  Loader2,
  Search as SearchIcon,
  X,
} from "lucide-react";

import {
  searchSuggestions,
  type SearchSuggestion,
} from "@/app/(storefront)/search/actions";

const RECENTS_KEY = "md.search.recents";
const MAX_RECENTS = 6;
const DEBOUNCE_MS = 180;

interface CategoryChip {
  name: string;
  slug: string;
}

interface SearchOverlayProps {
  open: boolean;
  onClose: () => void;
  /** Optional seed query (e.g. from the current /search?q=). */
  initialQuery?: string;
  /** Category chips shown when the query is empty. */
  categories?: CategoryChip[];
}

function loadRecents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string").slice(0, MAX_RECENTS)
      : [];
  } catch {
    return [];
  }
}

function pushRecent(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return loadRecents();
  const next = [trimmed, ...loadRecents().filter((r) => r !== trimmed)].slice(
    0,
    MAX_RECENTS,
  );
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / privacy-mode failures
  }
  return next;
}

/** Splits `text` around case-insensitive matches of `query` for highlighting. */
function highlight(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const idx = lower.indexOf(needle, i);
    if (idx === -1) {
      out.push(text.slice(i));
      break;
    }
    if (idx > i) out.push(text.slice(i, idx));
    out.push(
      <mark
        key={key++}
        className="rounded-sm bg-primary/15 text-primary [font-weight:inherit]"
      >
        {text.slice(idx, idx + needle.length)}
      </mark>,
    );
    i = idx + needle.length;
  }
  return out;
}

export function SearchOverlay({
  open,
  onClose,
  initialQuery = "",
  categories = [],
}: SearchOverlayProps) {
  const router = useRouter();
  const [query, setQuery] = React.useState(initialQuery);
  const [results, setResults] = React.useState<SearchSuggestion[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [recents, setRecents] = React.useState<string[]>(loadRecents);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const reqId = React.useRef(0);

  // Reset query + refresh recents + focus when (re)opened. State updates run
  // in the deferred timeout callback, not synchronously in the effect body.
  React.useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      setQuery(initialQuery);
      setRecents(loadRecents());
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

  // Escape to close.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Debounced instant search. All state mutation happens inside the timer
  // callback so nothing is set synchronously during the effect body.
  const trimmedQuery = query.trim();
  React.useEffect(() => {
    if (!open) return;
    if (trimmedQuery.length === 0) {
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
        const rows = await searchSuggestions(trimmedQuery);
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
  }, [trimmedQuery, open]);

  const submit = React.useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      setRecents(pushRecent(trimmed));
      onClose();
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    },
    [onClose, router],
  );

  const openProduct = React.useCallback(
    (suggestion: SearchSuggestion) => {
      pushRecent(query);
      onClose();
      router.push(`/p/${suggestion.slug}`);
    },
    [onClose, router, query],
  );

  const clearRecents = () => {
    try {
      window.localStorage.removeItem(RECENTS_KEY);
    } catch {
      // ignore
    }
    setRecents([]);
  };

  if (!open) return null;

  const trimmed = query.trim();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search products"
      className="fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)]"
    >
      {/* Search bar */}
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
            onKeyDown={(e) => {
              if (e.key === "Enter") submit(query);
            }}
            type="search"
            enterKeyHint="search"
            placeholder="Search products, brands…"
            aria-label="Search products"
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

      {/* Body */}
      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 py-4">
        {trimmed.length === 0 ? (
          <div className="space-y-6">
            {recents.length > 0 ? (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Recent
                  </h2>
                  <button
                    type="button"
                    onClick={clearRecents}
                    className="text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    Clear
                  </button>
                </div>
                <ul className="space-y-1">
                  {recents.map((r) => (
                    <li key={r}>
                      <button
                        type="button"
                        onClick={() => submit(r)}
                        className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left text-sm text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
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

            {categories.length > 0 ? (
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
        ) : results.length === 0 && !loading ? (
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
            <ul className="space-y-1">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => openProduct(r)}
                    className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
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
    </div>
  );
}
