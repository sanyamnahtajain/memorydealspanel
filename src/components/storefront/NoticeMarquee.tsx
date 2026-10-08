import { Megaphone } from "lucide-react";

/**
 * NoticeMarquee — the slim, top-of-page notice line (the trade-store "bhav
 * badal sakta hai" ticker), done QUIETLY: near-black band, small type, a
 * "Notice" tag on the left and a slow, edge-faded scroll on the right. It
 * reads as a considered part of the header, not an alarm.
 *
 * Pure CSS animation:
 *  - the line is duplicated and translated -50% in a loop, so the scroll is
 *    seamless at any viewport width (hover pauses it);
 *  - `prefers-reduced-motion` stops the animation and shows a static,
 *    truncating line instead — the message still reads, nothing moves;
 *  - every copy but the first is aria-hidden (the two extra copies inside a
 *    segment AND the whole duplicate segment), so screen readers hear the
 *    notice exactly once.
 *
 * Same API as before (`text`); the shell passes it as `topNotice`.
 */
export function NoticeMarquee({ text }: { text: string }) {
  const segment = (hidden: boolean) => (
    <span
      aria-hidden={hidden || undefined}
      className="inline-flex items-center gap-12 pr-12 motion-reduce:w-full motion-reduce:min-w-0 motion-reduce:pr-0"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden={hidden || i > 0 || undefined}
          className={
            i === 0
              ? // Reduced motion: this one copy becomes the static line and
                // truncates instead of scrolling.
                "inline-flex items-center gap-12 whitespace-nowrap motion-reduce:block motion-reduce:min-w-0 motion-reduce:truncate"
              : "inline-flex items-center gap-12 whitespace-nowrap motion-reduce:hidden"
          }
        >
          {text}
          <span
            aria-hidden
            className="size-1 rounded-full bg-background/40 motion-reduce:hidden"
          />
        </span>
      ))}
    </span>
  );

  return (
    <div
      role="status"
      className="bg-foreground text-background select-none"
    >
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-1.5 md:px-6">
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-background/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.14em] text-background/90 uppercase">
          <Megaphone className="size-3" aria-hidden />
          Notice
        </span>
        <div className="rail-fade-x min-w-0 flex-1 overflow-hidden text-xs font-medium tracking-wide text-background/85 motion-reduce:[mask-image:none]">
          <div className="md-ticker flex w-max motion-reduce:w-full motion-reduce:animate-none">
            {segment(false)}
            <span className="motion-reduce:hidden">{segment(true)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
