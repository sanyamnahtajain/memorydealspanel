"use client";

import * as React from "react";
import {
  AlertTriangle as AlertTriangleIcon,
  BadgeCheck as BadgeCheckIcon,
  Eye as EyeIcon,
  Hourglass as HourglassIcon,
  KeyRound as KeyRoundIcon,
  Lock as LockIcon,
  OctagonX as OctagonXIcon,
  ShoppingCart as ShoppingCartIcon,
  Sparkles as SparklesIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  agoLabel,
  OVERRIDE_REASON_MIN,
  type AccessReview,
  type TrailEvent,
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
  showNow = true,
}: {
  review: AccessReview;
  className?: string;
  maxFacts?: number;
  /** End the trail with a "now — asking again" point (open requests). */
  showNow?: boolean;
}) {
  const emphasise = review.level === "hold" || review.level === "watch";
  const hasTrail = review.history.trail.length > 0;
  return (
    <div className={cn("flex w-full flex-col gap-1.5", className)}>
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
      {hasTrail ? <AccessTrail review={review} showNow={showNow} /> : null}
      <Facts review={review} max={hasTrail ? Math.min(maxFacts, 3) : maxFacts} />
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
  showNow = true,
}: {
  review: AccessReview;
  className?: string;
  /** End the trail with a "now" point — false on a profile with live access. */
  showNow?: boolean;
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
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold text-foreground">{review.headline}</p>
          {review.advice ? (
            <p className="text-xs text-muted-foreground">{review.advice}</p>
          ) : null}
        </div>
      </div>
      {/* Full width under the headline — a phone needs every pixel here. */}
      <div className="mt-3 space-y-3">
        <ReviewStats review={review} />
        {review.history.trail.length > 0 || showNow ? (
          <AccessTrail review={review} variant="full" showNow={showNow} />
        ) : null}
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

/* ------------------------------------------------------------------ */
/* Graphics: verdict accent, trail, number tiles                       */
/* ------------------------------------------------------------------ */

/** A thin bar in the verdict's colour across the top of a card. */
export function ReviewAccentBar({
  level,
  side = "top",
}: {
  level: AccessReviewLevel;
  /** "top" for cards, "left" for list rows. */
  side?: "top" | "left";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute",
        side === "top" ? "inset-x-0 top-0 h-1" : "inset-y-0 left-0 w-1",
        level === "hold"
          ? "bg-destructive"
          : level === "watch"
            ? "bg-warning"
            : level === "good"
              ? "bg-success"
              : "bg-primary/60",
      )}
    />
  );
}

/**
 * Button styling that points at the action the review suggests: on a held
 * shop Reject is the solid button and Approve wears a lock.
 */
export function suggestedActions(level: AccessReviewLevel | undefined) {
  const hold = level === "hold";
  return {
    rejectClassName: hold
      ? "bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive dark:hover:bg-destructive/90"
      : undefined,
    approveVariant: hold ? ("outline" as const) : ("default" as const),
    ApproveIcon: hold ? LockIcon : null,
    approveLabel: hold ? "Approve…" : level === "watch" ? "Approve again" : "Approve",
  };
}

// Pinned to India time: the server renders in UTC, the phone in IST — an
// unpinned date near midnight would differ between the two (hydration error).
const shortDate = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Kolkata",
});
const longDate = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

function eventText(e: TrailEvent): string {
  const when = longDate.format(new Date(e.at));
  if (e.kind === "order") return `Order placed · ${when}`;
  return e.unused ? `Approved · ${when} · no order after` : `Approved · ${when} · ordered after`;
}

function TrailNode({
  event,
  full,
  align = "center",
}: {
  event: TrailEvent | "now";
  full: boolean;
  /** Where the note sits, so the first/last ones never run off the card. */
  align?: "start" | "center" | "end";
}) {
  const size = full ? "size-7" : "size-6";
  const icon = full ? "size-3.5" : "size-3";
  let look: string;
  let Icon: React.ComponentType<{ className?: string }>;
  let text: string;
  let label: string;
  if (event === "now") {
    look = "border-2 border-dashed border-muted-foreground/60 bg-background text-muted-foreground";
    Icon = HourglassIcon;
    text = "Now · asking for prices";
    label = "Now";
  } else if (event.kind === "order") {
    look = "bg-success text-white";
    Icon = ShoppingCartIcon;
    text = eventText(event);
    label = shortDate.format(new Date(event.at));
  } else if (event.unused) {
    look = "border-2 border-destructive bg-destructive/10 text-destructive";
    Icon = KeyRoundIcon;
    text = eventText(event);
    label = shortDate.format(new Date(event.at));
  } else {
    look = "border-2 border-success bg-background text-success";
    Icon = KeyRoundIcon;
    text = eventText(event);
    label = shortDate.format(new Date(event.at));
  }
  return (
    <li className="group relative flex shrink-0 flex-col items-center">
      {/* tabIndex -1: a tap (phone) focuses it and shows the same note a
          mouse gets on hover, but a dialog's auto-focus never lands here.
          Keyboard and screen-reader users get the whole story from the
          list's own label. */}
      <span
        tabIndex={-1}
        aria-label={text}
        className={cn(
          "grid place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          size,
          look,
        )}
      >
        <Icon className={icon} aria-hidden />
      </span>
      {full ? (
        // Hangs under the point without widening it, so seven dated points
        // still fit a phone. The ends align inward to stay on the card.
        <span
          className={cn(
            "absolute top-full mt-1 text-[10px] leading-none whitespace-nowrap text-muted-foreground tabular-nums",
            align === "start" ? "left-0" : align === "end" ? "right-0" : "left-1/2 -translate-x-1/2",
          )}
        >
          {label}
        </span>
      ) : null}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute bottom-full z-20 mb-1.5 hidden rounded-md bg-foreground px-2 py-1 text-[11px] whitespace-nowrap text-background shadow-md group-focus-within:block group-hover:block",
          align === "start" ? "left-0" : align === "end" ? "right-0" : "left-1/2 -translate-x-1/2",
        )}
      >
        {text}
      </span>
    </li>
  );
}

/** The line between two points: red and dashed after an unused approval. */
function TrailLink({ after, full }: { after: TrailEvent; full: boolean }) {
  const dead = after.kind === "approval" && after.unused;
  return (
    <li
      aria-hidden
      className={cn(
        "min-w-2 flex-1 self-start",
        full ? "mt-[13px]" : "mt-[11px]",
        dead ? "border-t-2 border-dashed border-destructive/60" : "h-0.5 bg-border",
      )}
    />
  );
}

/**
 * The shop's story on one line, oldest → newest: every approval (key) and
 * order (cart). An approval that no order followed is red, and so is the
 * stretch after it — "approved, nothing, approved, nothing" reads at a glance.
 */
export function AccessTrail({
  review,
  variant = "compact",
  showNow = true,
}: {
  review: AccessReview;
  variant?: "compact" | "full";
  showNow?: boolean;
}) {
  const full = variant === "full";
  const { trail, trailEarlier } = review.history;
  const summary = [
    trailEarlier ? `${trailEarlier} earlier` : null,
    ...trail.map(eventText),
    showNow ? "now asking for prices" : null,
  ]
    .filter(Boolean)
    .join("; ");

  return (
    <div className="space-y-2">
      <ol
        aria-label={`History: ${summary || "nothing yet"}`}
        className={cn("flex w-full items-start", full ? "pb-4" : "max-w-xs")}
      >
        {trailEarlier > 0 ? (
          <>
            <li className="relative flex shrink-0 flex-col items-center">
              <span
                className={cn(
                  "grid place-items-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground tabular-nums",
                  full ? "size-7" : "size-6",
                )}
              >
                +{trailEarlier}
              </span>
              {full ? (
                <span className="absolute top-full left-0 mt-1 text-[10px] leading-none whitespace-nowrap text-muted-foreground">
                  earlier
                </span>
              ) : null}
            </li>
            <li aria-hidden className={cn("h-0.5 min-w-2 flex-1 self-start bg-border", full ? "mt-[13px]" : "mt-[11px]")} />
          </>
        ) : null}
        {trail.map((event, i) => (
          <React.Fragment key={`${event.kind}-${event.at}`}>
            {i > 0 ? <TrailLink after={trail[i - 1]!} full={full} /> : null}
            <TrailNode
              event={event}
              full={full}
              align={
                i === 0 && trailEarlier === 0
                  ? "start"
                  : i === trail.length - 1 && !showNow
                    ? "end"
                    : "center"
              }
            />
          </React.Fragment>
        ))}
        {showNow ? (
          <>
            {trail.length > 0 ? <TrailLink after={trail[trail.length - 1]!} full={full} /> : null}
            <TrailNode event="now" full={full} align={trail.length > 0 ? "end" : "start"} />
          </>
        ) : null}
      </ol>
      {full && trail.length > 0 ? (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-label="Legend">
          <li className="inline-flex items-center gap-1">
            <span className="grid size-3.5 place-items-center rounded-full bg-success text-white">
              <ShoppingCartIcon className="size-2" aria-hidden />
            </span>
            Order
          </li>
          <li className="inline-flex items-center gap-1">
            <span className="grid size-3.5 place-items-center rounded-full border border-success text-success">
              <KeyRoundIcon className="size-2" aria-hidden />
            </span>
            Approved, then ordered
          </li>
          <li className="inline-flex items-center gap-1">
            <span className="grid size-3.5 place-items-center rounded-full border border-destructive bg-destructive/10 text-destructive">
              <KeyRoundIcon className="size-2" aria-hidden />
            </span>
            Approved, no order after
          </li>
        </ul>
      ) : null}
    </div>
  );
}

/** Four numbers that decide it: orders, last order, unused approvals, views. */
export function ReviewStats({ review }: { review: AccessReview }) {
  const h = review.history;
  const unusedTone =
    h.approvalsSinceLastOrder >= 2
      ? "text-destructive"
      : h.approvalsSinceLastOrder === 1
        ? "text-amber-700 dark:text-amber-300"
        : "text-success";
  const tiles: {
    label: string;
    value: string;
    sub?: string;
    icon: React.ComponentType<{ className?: string }>;
    iconClass: string;
  }[] = [
    {
      label: "Orders",
      value: String(h.ordersTotal),
      sub: h.cancelledTotal ? `+${h.cancelledTotal} cancelled` : h.ordersRecent ? `${h.ordersRecent} in 30 days` : undefined,
      icon: ShoppingCartIcon,
      iconClass: h.ordersTotal > 0 ? "text-success" : "text-muted-foreground",
    },
    {
      label: "Last order",
      value: h.lastOrderAt ? agoLabel(h.lastOrderAt).replace(" days ago", "d ago") : "Never",
      icon: HourglassIcon,
      iconClass: h.lastOrderAt ? "text-muted-foreground" : "text-destructive",
    },
    {
      label: "Approved, no order",
      value: h.approvalsTotal ? `${h.approvalsSinceLastOrder} of ${h.approvalsTotal}` : "—",
      icon: KeyRoundIcon,
      iconClass: h.approvalsTotal ? unusedTone : "text-muted-foreground",
    },
    {
      label: "Seen in 30 days",
      value: String(h.viewsRecent),
      sub: "products",
      icon: EyeIcon,
      iconClass: "text-muted-foreground",
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <div key={t.label} className="rounded-lg border border-border/70 bg-background/70 px-2.5 py-2">
            <dt className="flex items-center gap-1 text-[11px] font-medium whitespace-nowrap text-muted-foreground">
              <Icon className={cn("size-3", t.iconClass)} aria-hidden />
              {t.label}
            </dt>
            <dd className="mt-0.5 text-base leading-tight font-semibold text-foreground tabular-nums">
              {t.value}
              {t.sub ? (
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">{t.sub}</span>
              ) : null}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
