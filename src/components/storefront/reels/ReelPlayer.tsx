"use client";

import * as React from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";

import type { StorefrontReel } from "@/lib/reels";
import { INSTAGRAM_PROFILE_URL } from "@/lib/reels";
import { catalogImageUrl } from "@/lib/image-loader";
import { hapticTap } from "@/lib/haptics";
import { cn } from "@/lib/utils";

/**
 * ReelPlayer — one clip, fully self-governing.
 *
 * The feed tells a player whether it is the CURRENT reel (`active`), whether
 * the person asked for sound, and whether autoplay is allowed right now
 * (reduced motion / hidden tab). The player decides the rest:
 *
 *  - It plays only while it is actually on screen (IntersectionObserver,
 *    threshold 0.6) AND active AND not paused by the person. A reel that
 *    scrolls away is paused and rewound, so returning to it starts clean and
 *    exactly ONE clip is ever playing.
 *  - `play()` can be refused (autoplay policy, data saver). A refusal is not
 *    an error: the poster stays and a play button appears.
 *  - A clip that cannot be decoded or fetched shows its poster, says so, and
 *    offers Instagram, where the same clip lives.
 *  - The frame is NEVER cropped: the clip is object-contain over a blurred
 *    copy of its poster, the same ambient-fill trick the hero banners use, so
 *    a caption burned into the video stays readable on a 9:19 phone.
 *
 * Note on `muted`: React does not serialise `muted` into server HTML (an old
 * React quirk), so iOS cannot start the clip before hydration anyway. Playback
 * is therefore driven from the effect, which sets `muted` on the element
 * BEFORE calling `play()` — the order iOS insists on.
 */

export interface ReelPlayerHandle {
  /** Flip the person's pause for this clip — only if it is visible. */
  togglePause(): void;
}

export interface ReelPlayerProps {
  reel: StorefrontReel;
  /** The feed's current reel. Inactive clips never play. */
  active: boolean;
  muted: boolean;
  /** False under reduced motion: clips wait for a tap. */
  autoplay: boolean;
  /** True while the tab is hidden: everything pauses, intent is kept. */
  suspended: boolean;
  preload: "auto" | "metadata" | "none";
  /** Reports whether ≥60% of this clip is on screen. */
  onVisibility?: (visible: boolean) => void;
  onToggleMute: () => void;
  /** Eager poster — the first clip on the page. */
  priority?: boolean;
  /** Overlay content (actions, caption). Must let taps through to the clip. */
  children?: React.ReactNode;
  className?: string;
  ref?: React.Ref<ReelPlayerHandle>;
}

type Glyph = { kind: "play" | "pause"; key: number } | null;

const VISIBLE_THRESHOLD = 0.6;

export function ReelPlayer({
  reel,
  active,
  muted,
  autoplay,
  suspended,
  preload,
  onVisibility,
  onToggleMute,
  priority = false,
  children,
  className,
  ref,
}: ReelPlayerProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const barRef = React.useRef<HTMLSpanElement | null>(null);

  const [visible, setVisible] = React.useState(false);
  const visibleRef = React.useRef(false);
  // The person's own pause. Starts paused when autoplay is off (reduced
  // motion), so the first thing they see is a play button, not a moving frame.
  const [userPaused, setUserPaused] = React.useState(!autoplay);
  const [blocked, setBlocked] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [started, setStarted] = React.useState(false);
  const [glyph, setGlyph] = React.useState<Glyph>(null);

  const shouldPlay = active && visible && !userPaused && !suspended && !failed;

  // Derived-from-props resets, done during render (React's "adjusting state
  // when a prop changes" pattern) rather than in effects:
  //  - autoplay switched OFF after mount (reduced motion resolves
  //    post-hydration): pause, and stay paused until tapped;
  //  - autoplay switched ON after mount (the feed learns which layout is
  //    live only after hydration, and hands it autoplay then): the clip is
  //    allowed to start — otherwise it would sit behind a play button
  //    forever, having been born with autoplay=false;
  //  - a clip that scrolled away comes back fresh: intent and refusal reset.
  const [prevAutoplay, setPrevAutoplay] = React.useState(autoplay);
  if (prevAutoplay !== autoplay) {
    setPrevAutoplay(autoplay);
    setUserPaused(!autoplay);
  }
  const [prevActive, setPrevActive] = React.useState(active);
  if (prevActive !== active) {
    setPrevActive(active);
    if (!active) {
      setUserPaused(!autoplay);
      setBlocked(false);
    }
  }

  // …and the DOM half of "comes back fresh": rewind, empty the progress bar.
  React.useEffect(() => {
    if (active) return;
    const v = videoRef.current;
    if (v) {
      try {
        if (v.currentTime !== 0) v.currentTime = 0;
      } catch {
        /* no metadata yet — nothing to rewind */
      }
    }
    if (barRef.current) barRef.current.style.transform = "scaleX(0)";
  }, [active, autoplay]);

  // Visibility — the one source of truth for "is this clip on screen".
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const next = entry.isIntersecting && entry.intersectionRatio >= VISIBLE_THRESHOLD;
          if (next !== visibleRef.current) {
            visibleRef.current = next;
            setVisible(next);
            onVisibility?.(next);
          }
        }
      },
      { threshold: [0, VISIBLE_THRESHOLD, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [onVisibility]);

  // Play / pause. `muted` is applied to the element first: iOS refuses
  // `play()` on an unmuted video that the person has not tapped.
  React.useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
    if (shouldPlay) {
      // Older WebKit returns undefined from play(); jsdom throws. Normalise to
      // one promise so the outcome is always handled the same way.
      let outcome: Promise<void>;
      try {
        outcome = Promise.resolve(v.play());
      } catch (error) {
        outcome = Promise.reject(error);
      }
      let cancelled = false;
      outcome.then(
        () => {
          if (cancelled) return;
          setBlocked(false);
          setStarted(true);
        },
        () => {
          if (!cancelled) setBlocked(true);
        },
      );
      return () => {
        cancelled = true;
      };
    } else {
      try {
        v.pause();
      } catch {
        /* jsdom / detached element */
      }
    }
  }, [shouldPlay, muted]);

  // A video whose request failed BEFORE hydration never fires onError on the
  // React handler — ask the element directly, the way BannerCarousel does.
  const checkAlreadyFailed = React.useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node && node.error) setFailed(true);
  }, []);

  const onTimeUpdate = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = event.currentTarget;
    const duration =
      Number.isFinite(v.duration) && v.duration > 0 ? v.duration : (reel.durationSec ?? 0);
    const ratio = duration > 0 ? Math.min(1, v.currentTime / duration) : 0;
    if (barRef.current) barRef.current.style.transform = `scaleX(${ratio})`;
  };

  const togglePause = React.useCallback(() => {
    if (failed) return;
    hapticTap();
    setUserPaused((paused) => {
      const next = !paused;
      setGlyph({ kind: next ? "pause" : "play", key: Date.now() });
      return next;
    });
    setBlocked(false);
  }, [failed]);

  React.useImperativeHandle(
    ref,
    () => ({
      togglePause: () => {
        if (visibleRef.current) togglePause();
      },
    }),
    [togglePause],
  );

  const showPlayButton = !failed && (userPaused || blocked) && active;
  const poster = reel.posterUrl;
  const posterSrc = poster ? catalogImageUrl(poster, 640) : null;

  return (
    <div
      ref={rootRef}
      className={cn("relative h-full w-full select-none overflow-hidden bg-black text-white", className)}
      data-reel-id={reel.id}
    >
      {/* Ambient fill: the poster, enlarged and blurred, so the letterbox is
          never two black bars. Decorative; the poster proper carries the alt. */}
      {posterSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          aria-hidden
          src={catalogImageUrl(poster!, 128)}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full scale-125 object-cover opacity-60 blur-2xl saturate-125"
        />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,var(--color-neutral-700),var(--color-neutral-950)_70%)]"
        />
      )}

      {/* Poster — visible until the first frame plays, and again on failure. */}
      {posterSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={posterSrc}
          srcSet={`${catalogImageUrl(poster!, 384)} 384w, ${catalogImageUrl(poster!, 640)} 640w, ${catalogImageUrl(poster!, 828)} 828w`}
          sizes="(min-width: 768px) 28rem, 100vw"
          alt=""
          draggable={false}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          className={cn(
            "absolute inset-0 h-full w-full object-contain transition-opacity duration-300",
            started && !failed ? "opacity-0" : "opacity-100",
          )}
        />
      ) : null}

      {!failed ? (
        <video
          ref={checkAlreadyFailed}
          src={reel.videoUrl}
          poster={posterSrc ?? undefined}
          preload={preload}
          playsInline
          muted={muted}
          loop
          disablePictureInPicture
          controls={false}
          // Best effort for the first clip before hydration (harmless when the
          // browser refuses — the effect takes over). Never on inactive clips.
          autoPlay={active && autoplay}
          aria-label={reel.caption}
          onTimeUpdate={onTimeUpdate}
          onPlaying={() => setStarted(true)}
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-contain"
        />
      ) : null}

      {/* The whole frame toggles pause. A button, so it is keyboard-reachable
          and announced; the overlay children sit ABOVE it with their own
          pointer-events so their taps never reach here. */}
      {!failed ? (
        <button
          type="button"
          onClick={togglePause}
          aria-label={userPaused || blocked ? "Play reel" : "Pause reel"}
          className="absolute inset-0 z-10 cursor-default outline-none focus-visible:ring-3 focus-visible:ring-white/60 focus-visible:ring-inset"
        />
      ) : null}

      {/* Centred confirmation glyph — keyed so every tap replays it. */}
      {glyph && !showPlayButton ? (
        <span
          key={glyph.key}
          aria-hidden
          onAnimationEnd={() => setGlyph(null)}
          className="reel-glyph pointer-events-none absolute left-1/2 top-1/2 z-20 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm"
        >
          {glyph.kind === "pause" ? (
            <Pause className="size-7 fill-white" />
          ) : (
            <Play className="ml-0.5 size-7 fill-white" />
          )}
        </span>
      ) : null}

      {/* Paused / blocked: a real play button, big enough for a thumb. */}
      {showPlayButton ? (
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 z-20 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-black shadow-lg"
        >
          <Play className="ml-1 size-7 fill-black" />
        </span>
      ) : null}

      {/* Failed clip: poster stays, say so, point at Instagram. */}
      {failed ? (
        <div
          role="status"
          className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center px-6 text-center"
        >
          {/* Centred so it never sits under the caption / product chip that the
              phone overlay anchors to the bottom edge. */}
          <div className="pointer-events-auto flex flex-col items-center gap-3 rounded-2xl bg-black/60 px-5 py-4 shadow-lg ring-1 ring-white/10 backdrop-blur-sm">
          <p className="text-sm font-medium text-white/90">Couldn&apos;t play this clip.</p>
          <a
            href={reel.instagramUrl ?? INSTAGRAM_PROFILE_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={hapticTap}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-semibold text-black outline-none transition-transform hover:bg-white/90 focus-visible:ring-3 focus-visible:ring-white/60 active:scale-[0.98]"
          >
            Watch on Instagram
          </a>
          </div>
        </div>
      ) : null}

      {/* Mute — top right, out of the way of the right-hand action rail. */}
      {!failed ? (
        <button
          type="button"
          onClick={() => {
            hapticTap();
            onToggleMute();
          }}
          // Action label only (no aria-pressed): "Unmute" already says what
          // the tap does, and a pressed state on top would contradict it.
          aria-label={muted ? "Unmute" : "Mute"}
          className="absolute right-3 top-3 z-30 inline-flex size-11 items-center justify-center rounded-full bg-black/45 text-white outline-none backdrop-blur-sm transition-[background-color,transform] duration-150 hover:bg-black/60 focus-visible:ring-3 focus-visible:ring-white/60 active:scale-90"
        >
          {muted ? <VolumeX className="size-5" aria-hidden /> : <Volume2 className="size-5" aria-hidden />}
        </button>
      ) : null}

      {/* Overlay (caption, actions) — above the tap target. */}
      {children ? <div className="pointer-events-none absolute inset-0 z-30">{children}</div> : null}

      {/* Progress — a hairline along the bottom edge. */}
      {!failed ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-30 block h-0.5 bg-white/20"
        >
          <span
            ref={barRef}
            className="reel-progress block h-full w-full bg-white"
            style={{ transform: "scaleX(0)" }}
          />
        </span>
      ) : null}
    </div>
  );
}
