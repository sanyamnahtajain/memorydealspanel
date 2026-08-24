import * as React from "react";

import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * A live preview of the notification card as it lands on a phone.
 *
 * Deliberately literal — app icon, app name, "now", title, two-line body — so
 * the owner sees the real thing before sending, including where a too-long
 * title gets cut off. Phones truncate; so does this.
 *
 * Presentational and server-safe: no state, no effects. The composer re-renders
 * it on every keystroke.
 */

export interface NotificationPreviewCardProps {
  title: string;
  body: string;
  /** Shown under the card as the page a tap opens. */
  url?: string | null;
  className?: string;
}

export function NotificationPreviewCard({
  title,
  body,
  url,
  className,
}: NotificationPreviewCardProps) {
  const shownTitle = title.trim() || "Your title goes here";
  const shownBody = body.trim() || "Your message goes here.";
  const empty = title.trim() === "" && body.trim() === "";

  return (
    <div className={cn("space-y-2", className)}>
      {/* The phone: a rounded slab with a dim wallpaper the card sits on. */}
      <div className="rounded-2xl border border-border bg-gradient-to-b from-muted to-muted/40 p-3 sm:p-4">
        <p className="mb-2 text-center text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
          On the phone
        </p>
        <div
          className={cn(
            "rounded-xl border border-border/60 bg-card p-3 shadow-sm",
            empty && "opacity-60",
          )}
        >
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="flex size-5 shrink-0 items-center justify-center rounded-[6px] bg-primary text-[0.6rem] font-bold text-primary-foreground"
            >
              {APP_NAME.slice(0, 1)}
            </span>
            <span className="truncate text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
              {APP_NAME}
            </span>
            <span className="ml-auto shrink-0 text-[0.7rem] text-muted-foreground">
              now
            </span>
          </div>
          <p className="mt-1.5 line-clamp-1 text-sm font-semibold break-words text-foreground">
            {shownTitle}
          </p>
          <p className="mt-0.5 line-clamp-2 text-sm break-words text-muted-foreground">
            {shownBody}
          </p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {url?.trim()
          ? `Tapping it opens ${url.trim()}`
          : "Tapping it opens the shop home page."}
      </p>
    </div>
  );
}
