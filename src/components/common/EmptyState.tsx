import * as React from "react";
import { cn } from "@/lib/utils";

export type EmptyStateIllustration = "empty-box" | "no-results" | "locked";

/* ------------------------------------------------------------------ */
/* Built-in minimal illustrations                                      */
/* All strokes/fills use theme token colors via Tailwind svg utilities */
/* ------------------------------------------------------------------ */

function EmptyBoxIllustration(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 120 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...props}
    >
      {/* ground */}
      <path
        d="M14 84h92"
        className="stroke-border"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="1 7"
      />
      {/* box body */}
      <path
        d="M34 44h52v34a2 2 0 0 1-2 2H36a2 2 0 0 1-2-2V44Z"
        className="fill-muted stroke-muted-foreground"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* open flaps */}
      <path
        d="M34 44 22 32l26-4 12 16M86 44l12-12-26-4-12 16"
        className="fill-card stroke-muted-foreground"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* front seam */}
      <path d="M60 44v36" className="stroke-muted-foreground/40" strokeWidth="2" />
      {/* floating sparkles */}
      <path
        d="M60 12v8M56 16h8M92 18l4 4M96 18l-4 4"
        className="stroke-primary"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="26" cy="16" r="2" className="fill-primary/60" />
    </svg>
  );
}

function NoResultsIllustration(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 120 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...props}
    >
      {/* ground */}
      <path
        d="M18 84h84"
        className="stroke-border"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="1 7"
      />
      {/* lens */}
      <circle
        cx="54"
        cy="42"
        r="24"
        className="fill-muted stroke-muted-foreground"
        strokeWidth="2"
      />
      <circle cx="54" cy="42" r="17" className="fill-card" />
      {/* nothing found: small x inside lens */}
      <path
        d="M48 36l12 12M60 36 48 48"
        className="stroke-destructive/70"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* handle */}
      <path
        d="M72 60 86 74"
        className="stroke-muted-foreground"
        strokeWidth="5"
        strokeLinecap="round"
      />
      {/* stray result dots drifting away */}
      <circle cx="94" cy="30" r="2" className="fill-primary/60" />
      <circle cx="102" cy="44" r="1.5" className="fill-primary/40" />
      <circle cx="22" cy="26" r="2" className="fill-primary/60" />
    </svg>
  );
}

function LockedIllustration(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 120 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...props}
    >
      {/* ground */}
      <path
        d="M22 84h76"
        className="stroke-border"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="1 7"
      />
      {/* shackle */}
      <path
        d="M44 44V32a16 16 0 0 1 32 0v12"
        className="stroke-muted-foreground"
        strokeWidth="4"
        strokeLinecap="round"
      />
      {/* body */}
      <rect
        x="34"
        y="44"
        width="52"
        height="34"
        rx="6"
        className="fill-muted stroke-muted-foreground"
        strokeWidth="2"
      />
      {/* keyhole */}
      <circle cx="60" cy="58" r="4" className="fill-primary" />
      <path
        d="M60 61v8"
        className="stroke-primary"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* hint sparkles */}
      <path
        d="M94 22l4 4M98 22l-4 4M20 34v6M17 37h6"
        className="stroke-primary/60"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

const ILLUSTRATIONS: Record<
  EmptyStateIllustration,
  React.ComponentType<React.SVGProps<SVGSVGElement>>
> = {
  "empty-box": EmptyBoxIllustration,
  "no-results": NoResultsIllustration,
  locked: LockedIllustration,
};

/* ------------------------------------------------------------------ */
/* EmptyState                                                          */
/* ------------------------------------------------------------------ */

interface EmptyStateProps {
  /**
   * One of the built-in minimal illustrations, or any custom node
   * (e.g. your own inline SVG) for the illustration slot.
   */
  illustration?: EmptyStateIllustration | React.ReactNode;
  title: string;
  description?: string;
  /** Action slot, e.g. a Button or a Link. */
  action?: React.ReactNode;
  className?: string;
}

/**
 * Designed empty state: illustration, title, description and an action
 * slot. Used for empty lists, zero search results and gated content.
 * Server component.
 */
export function EmptyState({
  illustration = "empty-box",
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  let art: React.ReactNode;
  if (typeof illustration === "string" && illustration in ILLUSTRATIONS) {
    const Illustration = ILLUSTRATIONS[illustration as EmptyStateIllustration];
    art = <Illustration className="h-24 w-30" />;
  } else {
    art = illustration;
  }

  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-xl px-6 py-10 text-center",
        className
      )}
    >
      {art ? <div className="mb-3 text-muted-foreground">{art}</div> : null}
      <h3 className="text-base font-semibold text-balance text-foreground">{title}</h3>
      {description ? (
        <p className="max-w-sm text-sm text-pretty text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
