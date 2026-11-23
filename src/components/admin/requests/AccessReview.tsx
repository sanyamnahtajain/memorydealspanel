"use client";

import * as React from "react";
import {
  AlertTriangle as AlertTriangleIcon,
  BadgeCheck as BadgeCheckIcon,
  OctagonX as OctagonXIcon,
  Sparkles as SparklesIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  OVERRIDE_REASON_MIN,
  type AccessReview,
  type AccessReviewLevel,
  type FactTone,
} from "@/lib/access-review";

/**
 * How an approval review (src/lib/access-review.ts) looks on screen. Used by
 * every surface that gives price access, so a shop that never orders looks
 * the same on the request card, the renewal row and the customer profile.
 */

const LEVEL: Record<
  AccessReviewLevel,
  { label: string; icon: React.ComponentType<{ className?: string }>; pill: string; box: string }
> = {
  new: {
    label: "New",
    icon: SparklesIcon,
    pill: "border-primary/30 bg-primary/10 text-primary",
    box: "border-primary/20 bg-primary/5",
  },
  good: {
    label: "Ordered",
    icon: BadgeCheckIcon,
    pill: "border-success/30 bg-success/10 text-success",
    box: "border-success/25 bg-success/5",
  },
  watch: {
    label: "Careful",
    icon: AlertTriangleIcon,
    pill: "border-warning/40 bg-warning/15 text-amber-800 dark:text-amber-300",
    box: "border-warning/40 bg-warning/10",
  },
  hold: {
    label: "Hold",
    icon: OctagonXIcon,
    pill: "border-destructive/30 bg-destructive/10 text-destructive",
    box: "border-destructive/30 bg-destructive/10",
  },
};

const FACT: Record<FactTone, string> = {
  neutral: "border-border bg-muted/40 text-muted-foreground",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/40 bg-warning/10 text-amber-800 dark:text-amber-300",
  destructive: "border-destructive/25 bg-destructive/10 text-destructive",
};

export function ReviewLevelPill({
  level,
  className,
}: {
  level: AccessReviewLevel;
  className?: string;
}) {
  const meta = LEVEL[level];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        meta.pill,
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {meta.label}
    </span>
  );
}

function Facts({ review, max }: { review: AccessReview; max?: number }) {
  const facts = max ? review.facts.slice(0, max) : review.facts;
  if (facts.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Order and approval history">
      {facts.map((fact) => (
        <li
          key={fact.label}
          className={cn("rounded-md border px-1.5 py-0.5 text-[11px] font-medium", FACT[fact.tone])}
        >
          {fact.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Compact: the line under a request/renewal row. One sentence + the chips —
 * enough to decide without opening anything.
 */
export function AccessReviewLine({
  review,
  className,
  maxFacts = 4,
}: {
  review: AccessReview;
  className?: string;
  maxFacts?: number;
}) {
  const emphasise = review.level === "hold" || review.level === "watch";
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <p
        className={cn(
          "flex items-start gap-1.5 text-xs leading-snug",
          review.level === "hold"
            ? "font-semibold text-destructive"
            : review.level === "watch"
              ? "font-medium text-amber-800 dark:text-amber-300"
              : "text-muted-foreground",
        )}
      >
        <ReviewLevelPill level={review.level} className="mt-px" />
        <span className={emphasise ? undefined : "pt-0.5"}>{review.headline}</span>
      </p>
      <Facts review={review} max={maxFacts} />
    </div>
  );
}

/**
 * Full: the box inside an approve / renew dialog and the customer profile —
 * headline, advice and every fact.
 */
export function AccessReviewNotice({
  review,
  className,
}: {
  review: AccessReview;
  className?: string;
}) {
  const meta = LEVEL[review.level];
  const Icon = meta.icon;
  return (
    <div
      role={review.level === "hold" ? "alert" : undefined}
      className={cn("rounded-lg border p-3", meta.box, className)}
    >
      <div className="flex items-start gap-2">
        <Icon
          className={cn(
            "mt-0.5 size-4 shrink-0",
            review.level === "hold"
              ? "text-destructive"
              : review.level === "watch"
                ? "text-amber-700 dark:text-amber-300"
                : review.level === "good"
                  ? "text-success"
                  : "text-primary",
          )}
          aria-hidden
        />
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-semibold text-foreground">{review.headline}</p>
          {review.advice ? (
            <p className="text-xs text-muted-foreground">{review.advice}</p>
          ) : null}
          <Facts review={review} />
        </div>
      </div>
    </div>
  );
}

/**
 * State for an approve/renew confirm button guarded by a review:
 *  - hold  → the admin must type why before "Approve anyway" unlocks;
 *  - watch → allowed, but the button says "Approve again" so it is a choice;
 *  - else  → the normal button.
 * The server enforces the same hold (see `checkHold` in actions/access.ts).
 */
export function useApprovalGuard(review: AccessReview | null | undefined, resetKey: unknown) {
  const [reason, setReason] = React.useState("");
  const [forKey, setForKey] = React.useState(resetKey);
  if (forKey !== resetKey) {
    setForKey(resetKey);
    setReason("");
  }
  const level = review?.level;
  const held = level === "hold";
  const trimmed = reason.trim();
  return {
    held,
    reason,
    setReason,
    canConfirm: !held || trimmed.length >= OVERRIDE_REASON_MIN,
    override: held ? { reason: trimmed } : undefined,
    confirmLabel: (normal: string) =>
      held ? "Approve anyway" : level === "watch" ? "Approve again" : normal,
  };
}

/** The "why approve anyway?" field shown only for a held shop. */
export function OverrideReasonField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const short = value.trim().length > 0 && value.trim().length < OVERRIDE_REASON_MIN;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        Why approve anyway?
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        rows={2}
        maxLength={300}
        placeholder="e.g. Called them — order coming this week"
        aria-describedby={`${id}-help`}
        className="w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <p id={`${id}-help`} className={cn("text-xs", short ? "text-destructive" : "text-muted-foreground")}>
        {short
          ? `A few more words please (at least ${OVERRIDE_REASON_MIN} letters).`
          : "Saved in the activity log with your name."}
      </p>
    </div>
  );
}
