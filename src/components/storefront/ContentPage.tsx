import * as React from "react";

import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { FadeUp } from "@/components/motion/primitives";

/**
 * Shared layout for static content / legal pages (About, Privacy, Terms, FAQ,
 * Contact). Provides consistent, readable typography (a lightweight prose
 * container styled with token colors — no typography plugin needed) inside the
 * storefront shell.
 */
export function ContentPage({
  title,
  intro,
  updated,
  children,
}: {
  title: string;
  intro?: string;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <StorefrontShell>
      <FadeUp>
        <article className="mx-auto max-w-3xl py-6 md:py-10">
          <header className="mb-8">
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              {title}
            </h1>
            {intro ? (
              <p className="mt-3 text-base text-muted-foreground md:text-lg">
                {intro}
              </p>
            ) : null}
            {updated ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Last updated: {updated}
              </p>
            ) : null}
          </header>

          {/* Prose: token-styled headings, paragraphs, lists, links. */}
          <div
            className="
              space-y-5 text-[0.95rem] leading-relaxed text-foreground/90
              [&_a]:font-medium [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline
              [&_h2]:mt-9 [&_h2]:mb-2 [&_h2]:font-heading [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-foreground
              [&_h3]:mt-6 [&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground
              [&_p]:text-foreground/80
              [&_ul]:my-3 [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ul]:list-disc [&_ul>li]:text-foreground/80 [&_ul>li]:pl-1
              [&_ol]:my-3 [&_ol]:space-y-1.5 [&_ol]:pl-5 [&_ol]:list-decimal [&_ol>li]:text-foreground/80
              [&_strong]:font-semibold [&_strong]:text-foreground
            "
          >
            {children}
          </div>
        </article>
      </FadeUp>
    </StorefrontShell>
  );
}
