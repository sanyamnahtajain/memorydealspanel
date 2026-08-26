"use client";

import * as React from "react";
import { X } from "lucide-react";
import type { PublicProductImage } from "@/server/dto/product";
import { lockBodyScroll } from "@/lib/scroll-lock";
import { cn } from "@/lib/utils";

/**
 * Fullscreen product-photo lightbox — the viewer a phone shopper expects:
 *
 *  - swipe between photos (native scroll-snap: platform momentum, no drag shim)
 *  - single tap anywhere closes; double-tap zooms 2.5x at the tapped point
 *  - drag to pan while zoomed
 *  - counter + dots, arrow keys on desktop, Esc or the X to close
 *
 * Scrolling is locked through the shared ref-counted helper, never by writing
 * `document.body.style.overflow` here — two components doing that by hand is
 * what froze a whole site in production (see lib/scroll-lock.ts).
 *
 * While zoomed, the finger must pan the image instead of paging the strip.
 * That is `touch-action: none` on the active slide — NOT `overflow: hidden`
 * on the strip, which resets scrollLeft to 0 and silently threw the viewer
 * back to the first photo.
 *
 * Renders `PublicProductImage`s only — no price in scope, safe for any viewer.
 */
export function Lightbox({
  images,
  name,
  startIndex,
  onClose,
}: {
  images: PublicProductImage[];
  name: string;
  startIndex: number;
  onClose: () => void;
}) {
  const stripRef = React.useRef<HTMLDivElement | null>(null);
  const [active, setActive] = React.useState(startIndex);
  const [zoom, setZoom] = React.useState<{
    scale: number;
    x: number;
    y: number;
  } | null>(null);
  const lastTap = React.useRef(0);
  const tapTimer = React.useRef<number | null>(null);
  const panStart = React.useRef<{
    x: number;
    y: number;
    ox: number;
    oy: number;
  } | null>(null);

  /**
   * Page by `delta`. The index comes from where the strip ACTUALLY is, not
   * from `active` — the keydown handler is registered once, so closing over
   * state would freeze it at the opening photo forever.
   */
  const go = React.useCallback(
    (delta: number) => {
      const strip = stripRef.current;
      if (!strip || strip.clientWidth === 0) return;
      setZoom(null);
      const here = Math.round(strip.scrollLeft / strip.clientWidth);
      const next = Math.max(0, Math.min(images.length - 1, here + delta));
      strip.scrollTo({ left: next * strip.clientWidth, behavior: "smooth" });
    },
    [images.length],
  );

  // Open on the tapped slide, lock scrolling, wire Esc/arrows.
  React.useEffect(() => {
    const strip = stripRef.current;
    if (strip) strip.scrollLeft = startIndex * strip.clientWidth;
    const releaseScroll = lockBodyScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      releaseScroll();
      document.removeEventListener("keydown", onKey);
      if (tapTimer.current !== null) window.clearTimeout(tapTimer.current);
    };
    // startIndex is the opening photo — deliberately read once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [go, onClose]);

  const onStripScroll = () => {
    const strip = stripRef.current;
    if (!strip || strip.clientWidth === 0) return;
    const i = Math.round(strip.scrollLeft / strip.clientWidth);
    setActive((prev) =>
      prev === i ? prev : Math.max(0, Math.min(images.length - 1, i)),
    );
  };

  /**
   * One tap closes, two zoom. The close is deferred by one tap-interval so a
   * genuine double-tap can cancel it — without that, tap-to-close and
   * double-tap-to-zoom cannot coexist.
   */
  const onTap = (e: React.MouseEvent | React.TouchEvent) => {
    const now = Date.now();
    const isDouble = now - lastTap.current < 300;
    lastTap.current = isDouble ? 0 : now;

    if (isDouble) {
      if (tapTimer.current !== null) {
        window.clearTimeout(tapTimer.current);
        tapTimer.current = null;
      }
      if (zoom) {
        setZoom(null);
        return;
      }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const point =
        "changedTouches" in e ? e.changedTouches[0] : (e as React.MouseEvent);
      const cx = point.clientX - rect.left - rect.width / 2;
      const cy = point.clientY - rect.top - rect.height / 2;
      setZoom({ scale: 2.5, x: -cx * 1.5, y: -cy * 1.5 });
      return;
    }

    // A first tap while zoomed means "reset", not "close" — otherwise the
    // viewer vanishes mid-inspection.
    if (zoom) return;
    if (tapTimer.current !== null) window.clearTimeout(tapTimer.current);
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
      onClose();
    }, 300);
  };

  const onPanStart = (e: React.TouchEvent) => {
    if (!zoom) return;
    const t = e.touches[0];
    panStart.current = { x: t.clientX, y: t.clientY, ox: zoom.x, oy: zoom.y };
  };
  const onPanMove = (e: React.TouchEvent) => {
    if (!zoom || !panStart.current) return;
    const t = e.touches[0];
    setZoom({
      scale: zoom.scale,
      x: panStart.current.ox + (t.clientX - panStart.current.x),
      y: panStart.current.oy + (t.clientY - panStart.current.y),
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${name} — photos`}
      className="fixed inset-0 z-50 bg-black"
    >
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-4">
        <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-medium tabular-nums text-white">
          {active + 1} / {images.length}
        </span>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="rounded-full bg-white/10 p-2.5 text-white outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/50"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>

      <div
        ref={stripRef}
        onScroll={onStripScroll}
        className="no-scrollbar flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
      >
        {images.map((img, i) => (
          <div
            key={`${img.url}-${i}`}
            className="relative h-full w-full shrink-0 snap-center"
            onClick={onTap}
            onTouchStart={onPanStart}
            onTouchMove={onPanMove}
            style={{ touchAction: zoom && i === active ? "none" : undefined }}
          >
            <div
              className="absolute inset-0 transition-transform duration-200 motion-reduce:transition-none"
              style={
                zoom && i === active
                  ? {
                      transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
                    }
                  : undefined
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={i === 0 ? name : ""}
                draggable={false}
                loading={i === startIndex ? "eager" : "lazy"}
                className="absolute inset-0 h-full w-full object-contain"
              />
            </div>
          </div>
        ))}
      </div>

      {images.length > 1 ? (
        <div className="pointer-events-none absolute bottom-6 left-1/2 flex -translate-x-1/2 gap-1.5">
          {images.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full bg-white transition-all",
                i === active ? "w-6" : "w-1.5 opacity-40",
              )}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
