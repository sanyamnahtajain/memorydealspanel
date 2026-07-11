"use client";

import * as React from "react";
import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";
import { useReducedMotion } from "motion/react";
import { CheckIcon, SearchIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/components/common/use-is-mobile";

/**
 * Combobox — a custom, accessible autocomplete input that reduces typos by
 * suggesting values that already exist as the user types.
 *
 * NEVER a native `<datalist>`/`<select>`: it's a text `<input>` plus a filtered
 * popover list with full keyboard navigation (Up/Down/Enter/Esc), match
 * highlighting, loading + empty states, and — with `allowCreate` — the freedom
 * to commit whatever was typed even if it isn't in the list (needed for
 * open-ended fields like product spec keys/values and cities).
 *
 * Built on Base UI's Autocomplete primitive in `mode="none"`: the primitive
 * handles ARIA roles, focus and keyboard, while WE own the `items` list — either
 * a static `options` array (filtered/ranked locally) or an async `onSearch`
 * fetcher (debounced, results still ranked locally). The committed string is
 * always surfaced through `onValueChange`, so the parent stores free text.
 *
 * Design system: semantic tokens only, `motion` reduced-motion respected,
 * mobile-aware sizing via `use-is-mobile`. Bounded suggestion sources upstream
 * (cached DISTINCT queries) keep it scalable.
 */

/** Debounce delay (ms) before an async `onSearch` fires for the typed query. */
const SEARCH_DEBOUNCE_MS = 200;
/** Hard cap on rendered rows so a huge suggestion set can't blow up the popup. */
const MAX_VISIBLE = 50;

/** A suggestion: a bare string, or a `{ value, label }` pair for richer lists. */
export type ComboboxOption = string | { value: string; label?: string };

export interface ComboboxProps {
  /** Controlled text value. Parent stores whatever is typed/selected. */
  value: string;
  /** Fires with the committed string (typed or picked). */
  onValueChange: (value: string) => void;
  /**
   * Static suggestion list. Filtered + ranked client-side against the query.
   * Use this OR `onSearch` per field. Entries may be strings or `{value,label}`.
   */
  options?: readonly ComboboxOption[];
  /**
   * Async suggestion fetcher. Debounced; its returned list is ranked locally.
   * Use for server-backed DISTINCT sources (spec keys/values, admin cities).
   */
  onSearch?: (query: string) => Promise<string[]>;
  /**
   * When true, a typed value not present in the list can still be committed
   * (Enter / blur keeps free text). Essential for open-ended fields.
   */
  allowCreate?: boolean;
  /** Message shown when no suggestion matches the query. */
  emptyMessage?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  autoComplete?: string;
  className?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

/** A ranked row: the committed `value` plus the `label` shown to the user. */
interface Row {
  value: string;
  label: string;
}

/** Normalizes a string|object option into a `{ value, label }` row. */
function toRow(option: ComboboxOption): Row {
  if (typeof option === "string") return { value: option, label: option };
  return { value: option.value, label: option.label ?? option.value };
}

/** Case-insensitive prefix-first, then substring ranking; caps at MAX_VISIBLE. */
function rank(rows: readonly Row[], query: string): Row[] {
  const q = query.trim().toLowerCase();
  if (q === "") return rows.slice(0, MAX_VISIBLE);
  const prefix: Row[] = [];
  const contains: Row[] = [];
  for (const row of rows) {
    const lower = row.label.toLowerCase();
    if (lower.startsWith(q)) prefix.push(row);
    else if (lower.includes(q)) contains.push(row);
  }
  return [...prefix, ...contains].slice(0, MAX_VISIBLE);
}

/**
 * Splits `text` on the first case-insensitive occurrence of `query` and wraps
 * the match in a highlighted span, so the user sees which part they've typed.
 */
function Highlighted({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (q === "") return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="font-semibold text-foreground">
        {text.slice(idx, idx + q.length)}
      </span>
      {text.slice(idx + q.length)}
    </>
  );
}

export function Combobox({
  value,
  onValueChange,
  options,
  onSearch,
  allowCreate = false,
  emptyMessage = "No matches",
  placeholder,
  disabled,
  id,
  name,
  autoComplete,
  className,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedby,
}: ComboboxProps) {
  const reduced = useReducedMotion();
  const isMobile = useIsMobile();

  // `query` tracks what's actually in the input as the user types; `value` is
  // the committed field value. They diverge mid-typing, converge on commit.
  const [query, setQuery] = React.useState(value);
  const [fetched, setFetched] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(false);
  // Distinguishes "haven't searched yet" from "searched, found nothing" so we
  // can show a skeleton on first open instead of a premature empty state.
  const [hasSearched, setHasSearched] = React.useState(false);

  // Keep the input in sync when the parent resets/updates `value` externally.
  // Reconciled during render (React's "adjust state on prop change" pattern)
  // rather than in an effect, so there's no cascading-render round-trip.
  const [lastValue, setLastValue] = React.useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setQuery(value);
  }

  // Debounced async search. Latest-wins via a token so a slow early request
  // can't clobber a newer result. Static `options` never enters this path.
  // `setLoading(true)` runs inside the timeout (not synchronously in the effect
  // body) so the spinner tracks the request that actually fires.
  const tokenRef = React.useRef(0);
  React.useEffect(() => {
    if (!onSearch) return;
    const token = ++tokenRef.current;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await onSearch(query);
        if (tokenRef.current === token) {
          setFetched(results.map((v) => ({ value: v, label: v })));
          setHasSearched(true);
        }
      } catch {
        if (tokenRef.current === token) setFetched([]);
      } finally {
        if (tokenRef.current === token) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, onSearch]);

  // Normalize static options once; async results are already `Row[]`.
  const staticRows = React.useMemo(
    () => (options ? options.map(toRow) : []),
    [options],
  );

  // The ranked list handed to the primitive. Static options rank synchronously;
  // async results are re-ranked locally for the in-flight query so
  // highlighting/order stay consistent.
  const items = React.useMemo(() => {
    const source = onSearch ? fetched : staticRows;
    return rank(source, query);
  }, [onSearch, fetched, staticRows, query]);

  const showInitialSkeleton = Boolean(onSearch) && loading && !hasSearched;

  return (
    <AutocompletePrimitive.Root
      // `none`: WE filter/rank; the primitive doesn't second-guess the list,
      // which is what lets free-typed (create) values survive.
      mode="none"
      items={items}
      value={query}
      onValueChange={(next) => setQuery(next)}
      // Row objects → the string used for input display / activedescendant.
      itemToStringValue={(item: Row) => item.label}
      openOnInputClick
    >
      <div className={cn("relative", className)}>
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <AutocompletePrimitive.Input
          id={id}
          name={name}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedby}
          onKeyDown={(event) => {
            // allowCreate: Enter with no highlighted item commits free text.
            if (event.key === "Enter" && allowCreate) {
              const active = event.currentTarget.getAttribute(
                "aria-activedescendant",
              );
              if (!active) {
                onValueChange(event.currentTarget.value.trim());
              }
            }
          }}
          onBlur={(event) => {
            // Commit typed free text on blur when creation is allowed, so a
            // value the user typed but never "picked" isn't silently lost.
            if (allowCreate) onValueChange(event.currentTarget.value.trim());
          }}
          className={cn(
            "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent py-1 pr-2.5 pl-8 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30",
          )}
        />
        {loading && hasSearched ? (
          <Spinner
            aria-hidden
            className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
        ) : null}
      </div>

      <AutocompletePrimitive.Portal>
        <AutocompletePrimitive.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-50 outline-none"
        >
          <AutocompletePrimitive.Popup
            data-slot="combobox-popup"
            data-reduced-motion={reduced ? "" : undefined}
            className={cn(
              "max-h-[min(24rem,var(--available-height))] origin-(--transform-origin) overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg",
              "w-[max(var(--anchor-width),12rem)]",
              isMobile && "text-base",
              "transition-[transform,scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
              "data-reduced-motion:transition-none data-reduced-motion:data-ending-style:scale-100 data-reduced-motion:data-ending-style:opacity-100 data-reduced-motion:data-starting-style:scale-100 data-reduced-motion:data-starting-style:opacity-100",
            )}
          >
            {showInitialSkeleton ? (
              <div className="space-y-1 p-1" aria-hidden>
                <Skeleton className="h-7 w-full rounded-md" />
                <Skeleton className="h-7 w-4/5 rounded-md" />
                <Skeleton className="h-7 w-3/5 rounded-md" />
              </div>
            ) : null}

            {/* Empty state — kept mounted so screen readers announce changes;
                only its children swap (per Base UI guidance). */}
            <AutocompletePrimitive.Empty className="px-3 py-6 text-center text-sm text-muted-foreground empty:hidden">
              {showInitialSkeleton ? null : emptyMessage}
            </AutocompletePrimitive.Empty>

            <AutocompletePrimitive.List>
              {(item: Row) => (
                <AutocompletePrimitive.Item
                  key={item.value}
                  value={item}
                  onClick={() => onValueChange(item.value)}
                  className={cn(
                    "flex cursor-default items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm outline-none select-none",
                    "data-highlighted:bg-accent data-highlighted:text-accent-foreground",
                    isMobile && "py-2 text-base",
                  )}
                >
                  <span className="min-w-0 truncate text-muted-foreground">
                    <Highlighted text={item.label} query={query} />
                  </span>
                  {item.value.trim().toLowerCase() ===
                  value.trim().toLowerCase() ? (
                    <CheckIcon
                      aria-hidden
                      className="size-4 shrink-0 text-primary"
                    />
                  ) : null}
                </AutocompletePrimitive.Item>
              )}
            </AutocompletePrimitive.List>
          </AutocompletePrimitive.Popup>
        </AutocompletePrimitive.Positioner>
      </AutocompletePrimitive.Portal>
    </AutocompletePrimitive.Root>
  );
}
