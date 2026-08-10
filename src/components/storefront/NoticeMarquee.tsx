/**
 * NoticeMarquee — a slim, top-of-page attention bar with a continuously
 * scrolling notice line (the classic trade-store "bhav badal sakta hai"
 * ticker, done professionally). Pure CSS animation:
 *  - the line is duplicated and translated -50% in a loop, so the scroll is
 *    seamless at any viewport width;
 *  - `prefers-reduced-motion` stops the animation and shows a static,
 *    centered line instead — the message still reads, nothing moves;
 *  - the duplicate segment is aria-hidden so screen readers hear it once.
 */
export function NoticeMarquee({ text }: { text: string }) {
  const segment = (hidden: boolean) => (
    <span
      aria-hidden={hidden || undefined}
      className="inline-flex items-center gap-10 px-5"
    >
      {[0, 1, 2].map((i) => (
        <span key={i} className="inline-flex items-center gap-10 whitespace-nowrap">
          {text}
          <span aria-hidden className="text-white/60">
            •
          </span>
        </span>
      ))}
    </span>
  );

  return (
    <div
      role="status"
      className="overflow-hidden bg-red-600 py-1.5 text-xs font-medium tracking-wide text-white select-none"
    >
      <div className="md-marquee flex w-max motion-reduce:w-full motion-reduce:justify-center motion-reduce:animate-none">
        {segment(false)}
        <span className="motion-reduce:hidden">{segment(true)}</span>
      </div>
    </div>
  );
}
