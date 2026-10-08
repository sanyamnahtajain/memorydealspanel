"use client";

import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useReducedMotion } from "motion/react";

import type { StorefrontReel } from "@/lib/reels";
import { REELS_PAGE_SIZE } from "@/lib/reels";
import { hapticTap } from "@/lib/haptics";
import { cn } from "@/lib/utils";

import { ReelPlayer, type ReelPlayerHandle } from "./ReelPlayer";
import { ReelActions } from "./ReelActions";
import "./reels.css";

/**
 * ReelsFeed — the Instagram-like experience, in two bodies on one state.
 *
 * PHONES: a vertical scroll-snap feed. Each reel is exactly the space between
 * the sticky header and the fixed tab bar, snap-mandatory, so a flick lands
 * on the next clip the way the thumb expects. Native momentum, no JS scroll.
 * Which clip plays is decided by what is on screen (each player watches its
 * own visibility), so the feed and the browser never disagree.
 *
 * DESKTOP (md+): an immersive dark stage — one 9:16 player, previous/next,
 * keyboard (↑/↓, space, m) and the active clip's caption + CTAs beside it.
 *
 * Both are in the DOM and chosen by CSS (`md:hidden` / `hidden md:block`),
 * which is what keeps the server render identical to the first client render
 * — there is no "which device am I" guess to get wrong before hydration. A
 * hidden layout has zero visible area, so its players never intersect and
 * never play; exactly one clip plays at a time on either layout.
 *
 * Hidden is not free, though: `preload` and `autoplay` are HTML attributes
 * the browser honours on a `display:none` video, so the inactive layout would
 * download every clip a second time (tens of MB each, on mobile data). The
 * ACTIVE layout is therefore resolved in the browser from the same media
 * query the CSS uses, via useSyncExternalStore with a `null` server snapshot:
 * the server HTML and the hydrating render give EVERY player `preload="none"`
 * and no autoplay, and the very next render hands the live layout its real
 * preload/autoplay while the other keeps "none". Nothing is fetched twice,
 * and nothing is fetched before we know which copy is on screen.
 *
 * `?r=<id>` is read in the browser (window.location), NOT from the page's
 * `searchParams` — touching that prop would turn the ISR page dynamic.
 *
 * Phones render the first REELS_PAGE_SIZE clips and grow the list as the
 * person nears its end; the whole feed is ≤ MAX_REELS but 60 video elements
 * at once is still 60 video elements.
 */

const MUTED_STORAGE_KEY = "md:reels:muted";
/** Grow the phone list when the active reel is this close to its end. */
const GROW_AHEAD = 3;

// ——— the sound choice: a tiny external store, so the component reads it via
// useSyncExternalStore (server snapshot: muted) and never has to copy
// localStorage into state from an effect. In-memory first, localStorage when
// it allows — a private window still toggles, it just forgets on reload. ———
let mutedMemo: boolean | null = null;
const mutedListeners = new Set<() => void>();

function getMuted(): boolean {
  try {
    const raw = window.localStorage.getItem(MUTED_STORAGE_KEY);
    if (raw !== null) return raw !== "0";
  } catch {
    /* storage unavailable — fall through to memory */
  }
  return mutedMemo ?? true;
}
function getMutedServer(): boolean {
  return true;
}
function subscribeMuted(listener: () => void): () => void {
  mutedListeners.add(listener);
  return () => {
    mutedListeners.delete(listener);
  };
}
function setMutedPreference(muted: boolean): void {
  mutedMemo = muted;
  try {
    window.localStorage.setItem(MUTED_STORAGE_KEY, muted ? "1" : "0");
  } catch {
    /* private mode / quota — the choice simply does not persist */
  }
  mutedListeners.forEach((listener) => listener());
}

// ——— ?r=<id>: read the same way, so the hydrating render matches the server
// (null) and the very next render knows the start reel. ———
function subscribeNever(): () => void {
  return () => {};
}
function readStartId(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("r");
  } catch {
    return null;
  }
}
function readStartIdServer(): string | null {
  return null;
}

// ——— which layout is live: the md media query the CSS uses, as a store.
// Server snapshot null → "unknown", and every player stays preload="none".
const DESKTOP_QUERY = "(min-width: 768px)";
type Layout = "phone" | "desktop" | null;

function subscribeLayout(listener: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener("change", listener);
  return () => mql.removeEventListener("change", listener);
}
function getLayout(): Layout {
  try {
    return window.matchMedia(DESKTOP_QUERY).matches ? "desktop" : "phone";
  } catch {
    return "phone";
  }
}
function getLayoutServer(): Layout {
  return null;
}

/** How many phone items must exist for `index` to be on screen with room ahead. */
function pagesFor(index: number, total: number): number {
  return Math.min(total, Math.ceil((index + GROW_AHEAD + 1) / REELS_PAGE_SIZE) * REELS_PAGE_SIZE);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * A focused control that Space (or Enter) activates natively — a button, a
 * link, a listbox option. Preventing Space's default there would swallow the
 * activation, so the page-level Space shortcut must stand aside.
 */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('button, a, [role="button"], [role="option"]') !== null;
}

export function ReelsFeed({ reels, className }: { reels: StorefrontReel[]; className?: string }) {
  const total = reels.length;
  const reducedMotion = useReducedMotion() ?? false;

  const [active, setActive] = React.useState(0);
  const [suspended, setSuspended] = React.useState(false);
  const [rendered, setRendered] = React.useState(Math.min(REELS_PAGE_SIZE, total));
  // A programmatic scroll of the phone list (start reel, arrow keys). The
  // nonce lets the same index be requested twice.
  const [jump, setJump] = React.useState<{ index: number; nonce: number; smooth: boolean } | null>(null);

  const muted = React.useSyncExternalStore(subscribeMuted, getMuted, getMutedServer);
  const toggleMute = React.useCallback(() => setMutedPreference(!getMuted()), []);

  // Which body is on screen. null until hydration has told us; see the module
  // comment for why the other body's players must not fetch.
  const layout = React.useSyncExternalStore(subscribeLayout, getLayout, getLayoutServer);
  const phoneLive = layout === "phone";
  const stageLive = layout === "desktop";

  const activeRef = React.useRef(0);
  React.useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const listRef = React.useRef<HTMLDivElement | null>(null);
  const itemRefs = React.useRef<(HTMLElement | null)[]>([]);
  // Player handles for the keyboard; a stable Map mutated in ref callbacks.
  const [handles] = React.useState(() => new Map<string, ReelPlayerHandle>());

  /** Make `index` the current reel and make sure the phone list reaches it. */
  const activate = React.useCallback(
    (index: number) => {
      setActive(index);
      setRendered((n) => Math.max(n, pagesFor(index, total)));
    },
    [total],
  );

  // ——— ?r= start reel ———
  // Server snapshot null → the hydrating render matches the HTML; the client
  // snapshot arrives on the next render and is applied once, during render.
  const startId = React.useSyncExternalStore(subscribeNever, readStartId, readStartIdServer);
  const [startApplied, setStartApplied] = React.useState(false);
  if (!startApplied && startId !== null) {
    setStartApplied(true);
    const index = reels.findIndex((reel) => reel.id === startId);
    if (index > 0) {
      setActive(index);
      setRendered((n) => Math.max(n, pagesFor(index, total)));
      setJump({ index, nonce: 0, smooth: false });
    }
  }

  // Scroll the LIST (not the window — scrollIntoView would drag the page
  // under the sticky header) once the target item exists. Before paint, so a
  // ?r= landing never flashes the first clip.
  React.useLayoutEffect(() => {
    if (!jump) return;
    const list = listRef.current;
    const item = itemRefs.current[jump.index];
    if (!list || !item) return;
    if (jump.smooth && typeof list.scrollTo === "function") {
      list.scrollTo({ top: item.offsetTop, behavior: "smooth" });
    } else {
      list.scrollTop = item.offsetTop;
    }
  }, [jump, rendered]);

  // ——— hidden tab pauses everything, keeps intent ———
  React.useEffect(() => {
    const sync = () => setSuspended(document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  // ——— phone feed height: measure the real header + tab bar once mounted ———
  // The CSS calc in reels.css is the default; this refines it with what the
  // shell actually rendered (a condensed header, a notice strip, a browser
  // whose dvh lies), so the clip never ends under the tab bar.
  React.useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const phone = !window.matchMedia("(min-width: 768px)").matches;
      if (!phone) {
        list.style.removeProperty("--reel-h");
        return;
      }
      const header = document.querySelector<HTMLElement>("header.sticky");
      const tab = document.querySelector<HTMLElement>("nav.fixed.bottom-0");
      if (!header || !tab) return;
      const height = window.innerHeight - header.getBoundingClientRect().bottom - tab.offsetHeight;
      if (height > 240) list.style.setProperty("--reel-h", `${Math.round(height)}px`);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);

  // ——— navigation shared by arrows and keys ———
  const go = React.useCallback(
    (delta: 1 | -1) => {
      const current = activeRef.current;
      const next = Math.min(total - 1, Math.max(0, current + delta));
      if (next === current) return;
      activate(next);
      setJump({ index: next, nonce: Date.now(), smooth: !reducedMotion });
    },
    [total, reducedMotion, activate],
  );

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      switch (event.key) {
        case "ArrowDown":
        case "PageDown":
        case "j":
          event.preventDefault();
          go(1);
          break;
        case "ArrowUp":
        case "PageUp":
        case "k":
          event.preventDefault();
          go(-1);
          break;
        case " ":
          // Space on a focused button/link is that control's own activation
          // (the mute button, Share, the stage arrows, the clip's tap target);
          // leave it alone, or the page shortcut breaks native keyboard use.
          if (isInteractiveTarget(event.target)) return;
          event.preventDefault();
          handles.forEach((handle) => handle.togglePause());
          break;
        case "m":
        case "M":
          event.preventDefault();
          toggleMute();
          break;
        default:
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, toggleMute, handles]);

  // Stable per-index visibility handlers so each player's observer is built once.
  const visibilityHandlers = React.useMemo(
    () =>
      reels.map((_, index) => (visible: boolean) => {
        if (visible) activate(index);
      }),
    [reels, activate],
  );

  const registerHandle = (key: string) => (handle: ReelPlayerHandle | null) => {
    if (handle) handles.set(key, handle);
    else handles.delete(key);
  };

  // Phone list: the current clip in full, its neighbours' metadata, nothing
  // else — and nothing at all while the list is not the live layout.
  const preloadFor = (index: number): "auto" | "metadata" | "none" => {
    if (!phoneLive) return "none";
    return index === active ? "auto" : Math.abs(index - active) === 1 ? "metadata" : "none";
  };

  if (total === 0) return null;
  const current = reels[Math.min(active, total - 1)];

  return (
    <div className={className}>
      {/* ——— Phones: the snap feed ——— */}
      <div
        ref={listRef}
        role="feed"
        aria-label="Reels"
        aria-busy={rendered < total}
        // `relative`: the jump effect scrolls to item.offsetTop, which is
        // measured from the nearest positioned ancestor — this list, not the
        // document (header + notice above would otherwise offset every jump).
        className="reel-feed relative -mx-4 -mb-4 snap-y snap-mandatory overflow-y-auto overscroll-y-contain bg-black md:hidden"
      >
        {reels.slice(0, rendered).map((reel, index) => (
          <article
            key={reel.id}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            data-reel-item
            data-active={index === active || undefined}
            aria-label={`Reel ${index + 1} of ${total}`}
            aria-posinset={index + 1}
            aria-setsize={total}
            className="reel-item relative w-full snap-start snap-always"
          >
            <ReelPlayer
              ref={registerHandle(`phone-${reel.id}`)}
              reel={reel}
              active={index === active && phoneLive}
              muted={muted}
              autoplay={phoneLive && !reducedMotion}
              suspended={suspended}
              preload={preloadFor(index)}
              priority={index === 0}
              onVisibility={visibilityHandlers[index]}
              onToggleMute={toggleMute}
            >
              <span
                aria-hidden
                className="absolute left-4 top-4 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-semibold tabular-nums tracking-wide text-white/90 backdrop-blur-sm"
              >
                {index + 1} / {total}
              </span>
              <ReelActions reel={reel} layout="overlay" />
            </ReelPlayer>
          </article>
        ))}
        {rendered < total ? (
          <div
            aria-hidden
            className="reel-item flex w-full snap-start snap-always items-center justify-center bg-black text-sm text-white/60"
          >
            Loading more reels…
          </div>
        ) : null}
      </div>

      {/* ——— Desktop: the stage ———
          md (768–1023px): player + arrows centred, caption and CTAs stacked
          UNDER it — a side column would be squeezed to ~140px and clipped by
          the rounded, overflow-hidden panel. lg+: the two-column stage. */}
      <section
        aria-label="Reels"
        className="hidden overflow-hidden rounded-3xl bg-neutral-950 text-white ring-1 ring-foreground/10 md:block"
      >
        <div className="mx-auto grid max-w-5xl grid-cols-1 justify-items-center gap-10 px-6 py-8 lg:grid-cols-[auto_minmax(0,24rem)] lg:items-center lg:justify-center lg:justify-items-stretch lg:gap-16 lg:px-12 lg:py-10">
          <div className="flex items-center gap-5">
            <div
              key={current.id}
              className="reel-stage-in relative aspect-[9/16] h-[min(80vh,46rem)] overflow-hidden rounded-3xl shadow-2xl ring-1 ring-white/10"
            >
              <ReelPlayer
                ref={registerHandle("stage")}
                reel={current}
                active={stageLive}
                muted={muted}
                autoplay={stageLive && !reducedMotion}
                suspended={suspended}
                preload={stageLive ? "auto" : "none"}
                onToggleMute={toggleMute}
              />
            </div>

            <div className="flex flex-col items-center gap-3">
              <StageArrow label="Previous reel" disabled={active === 0} onClick={() => go(-1)}>
                <ChevronUp className="size-5" aria-hidden />
              </StageArrow>
              <span className="text-xs font-medium tabular-nums text-white/55" aria-live="polite">
                {active + 1}
                <span className="text-white/30"> / </span>
                {total}
              </span>
              <StageArrow label="Next reel" disabled={active >= total - 1} onClick={() => go(1)}>
                <ChevronDown className="size-5" aria-hidden />
              </StageArrow>
            </div>
          </div>

          <div className="flex w-full max-w-[24rem] flex-col gap-8 lg:max-w-none lg:gap-10">
            <ReelActions reel={current} layout="column" index={active} total={total} />
            <p className="text-xs text-white/35">
              <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-sans">↑</kbd>{" "}
              <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-sans">↓</kbd> browse
              <span className="mx-2 text-white/20">·</span>
              <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-sans">space</kbd> pause
              <span className="mx-2 text-white/20">·</span>
              <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-sans">m</kbd> sound
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function StageArrow({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        hapticTap();
        onClick();
      }}
      className={cn(
        "inline-flex size-11 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/15 outline-none transition-[background-color,transform,opacity] duration-150 hover:bg-white/20 focus-visible:ring-3 focus-visible:ring-white/60 active:scale-90",
        disabled && "pointer-events-none opacity-30",
      )}
    >
      {children}
    </button>
  );
}
