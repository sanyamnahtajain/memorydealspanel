import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { listLiveReels } from "@/server/services/reels";
import { INSTAGRAM_HANDLE, INSTAGRAM_PROFILE_URL } from "@/lib/reels";
import { APP_NAME } from "@/lib/constants";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { ReelsFeed } from "@/components/storefront/reels/ReelsFeed";
import { InstagramGlyph } from "@/components/storefront/reels/InstagramGlyph";

export const metadata: Metadata = {
  title: "Reels",
  description: `Short clips from ${APP_NAME} — new stock, demos and deals, straight from @${INSTAGRAM_HANDLE}.`,
};

/**
 * /reels — the Instagram-like feed.
 *
 * PUBLIC and PRICE-FREE, so it is served through ISR like the home page: the
 * read is listLiveReels (anonymous projection, fails to []), and nothing here
 * touches cookies, headers or `searchParams` — the `?r=<id>` start reel is
 * read in the browser by ReelsFeed, because reading it here would turn the
 * page dynamic for every visitor.
 */
export const revalidate = 120;

export default async function ReelsPage() {
  const reels = await listLiveReels();

  return (
    <StorefrontShell>
      {reels.length > 0 ? (
        <>
          {/* Phones get the feed edge to edge — a visible title above it would
              push the first clip under the tab bar — but the page still has a
              heading in the accessibility tree. */}
          <h1 className="sr-only md:hidden">Reels</h1>
          {/* Desktop page header. */}
          <div className="hidden items-end justify-between gap-4 py-8 md:flex">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                From our Instagram
              </p>
              <h1 className="mt-1 font-heading text-2xl font-bold tracking-tight md:text-3xl">Reels</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                New stock, quick demos and deals — the clips we post on @{INSTAGRAM_HANDLE}.
              </p>
            </div>
            <a
              href={INSTAGRAM_PROFILE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-muted px-4 text-sm font-semibold text-foreground outline-none ring-1 ring-foreground/5 transition-[background-color,transform] duration-150 hover:bg-muted/70 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]"
            >
              <InstagramGlyph className="size-4" />
              Follow @{INSTAGRAM_HANDLE}
            </a>
          </div>
          <ReelsFeed reels={reels} className="md:pb-4" />
        </>
      ) : (
        <ReelsEmpty />
      )}
    </StorefrontShell>
  );
}

/** No clip is live: a designed card, not a blank feed. */
function ReelsEmpty() {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center py-10">
      <div className="w-full max-w-md overflow-hidden rounded-3xl bg-foreground p-6 text-background shadow-md ring-1 ring-foreground/10 md:p-8">
        <div className="mx-auto flex aspect-[9/16] w-24 items-center justify-center rounded-2xl bg-[radial-gradient(120%_80%_at_50%_0%,var(--color-neutral-700),var(--color-neutral-950)_70%)] ring-1 ring-background/15">
          <InstagramGlyph className="size-8 text-background/80" />
        </div>
        <p className="mt-6 text-center text-[11px] font-medium uppercase tracking-[0.18em] text-background/60">
          Reels
        </p>
        <h1 className="mt-1 text-center font-heading text-2xl font-bold tracking-tight">
          Nothing playing right now
        </h1>
        <p className="mt-2 text-center text-sm text-background/70">
          New clips land here as we post them. Until then, the latest are on Instagram.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <a
            href={INSTAGRAM_PROFILE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-background px-5 text-sm font-semibold text-foreground outline-none transition-[transform,opacity] duration-150 hover:opacity-90 focus-visible:ring-3 focus-visible:ring-background/40 active:scale-[0.98]"
          >
            <InstagramGlyph className="size-4" />
            @{INSTAGRAM_HANDLE}
          </a>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-background/10 px-5 text-sm font-semibold text-background outline-none ring-1 ring-background/15 transition-[background-color,transform] duration-150 hover:bg-background/20 focus-visible:ring-3 focus-visible:ring-background/40 active:scale-[0.98]"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back to shop
          </Link>
        </div>
      </div>
    </div>
  );
}
