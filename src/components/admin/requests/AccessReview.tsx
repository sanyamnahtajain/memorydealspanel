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


/* ------------------------------------------------------------------ */
/* The verdict: a traffic light + one big word                        */
/* ------------------------------------------------------------------ */

/**
 * Words a person acts on without reading further. Colour is never the only
 * signal: the lit lamp sits next to the word, and the word is the decision.
 */
const VERDICT: Record<
  AccessReviewLevel,
  { word: string; lamp: "red" | "amber" | "green"; text: string }
> = {
  hold: { word: "Don’t approve", lamp: "red", text: "text-destructive" },
  watch: { word: "Ask first", lamp: "amber", text: "text-amber-700 dark:text-amber-300" },
  good: { word: "Good buyer", lamp: "green", text: "text-success" },
  new: { word: "New shop", lamp: "green", text: "text-foreground" },
};

const LAMP_ON: Record<"red" | "amber" | "green", string> = {
  red: "var(--destructive)",
  amber: "var(--warning)",
  green: "var(--success)",
};

/**
 * A three-lamp traffic light, drawn in SVG: red · amber · green, one lit.
 * Everyone already knows how to read it — stop, wait, go.
 */
export function TrafficLight({
  level,
  size = "sm",
  className,
}: {
  level: AccessReviewLevel;
  size?: "sm" | "lg";
  className?: string;
}) {
  const lit = VERDICT[level].lamp;
  const lamps = [
    { key: "red" as const, cx: 12 },
    { key: "amber" as const, cx: 32 },
    { key: "green" as const, cx: 52 },
  ];
  const id = React.useId();
  return (
    <svg
      viewBox="0 0 64 24"
      role="img"
      aria-label={`Traffic light: ${lit === "red" ? "red, stop" : lit === "amber" ? "amber, wait" : "green, go"}`}
      className={cn("shrink-0", size === "lg" ? "h-9 w-24" : "h-5 w-[3.375rem]", className)}
    >
      <defs>
        <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      {/* The housing is dark in BOTH themes (it's a traffic light), with a
          faint rim so it still reads against a dark card. */}
      <rect
        x="0.5"
        y="0.5"
        width="63"
        height="23"
        rx="11.5"
        className="fill-neutral-800 stroke-transparent dark:fill-black dark:stroke-white/15"
      />
      {lamps.map((lamp) => {
        const on = lamp.key === lit;
        return (
          <g key={lamp.key}>
            {on ? (
              <circle
                cx={lamp.cx}
                cy="12"
                r="8.5"
                fill={LAMP_ON[lamp.key]}
                opacity="0.6"
                filter={`url(#${id}-glow)`}
              />
            ) : null}
            <circle
              cx={lamp.cx}
              cy="12"
              r="7"
              fill={on ? LAMP_ON[lamp.key] : "currentColor"}
              className={on ? undefined : "text-white/20"}
            />
            {on ? <circle cx={lamp.cx - 2.2} cy="9.6" r="1.8" fill="white" opacity="0.55" /> : null}
          </g>
        );
      })}
    </svg>
  );
}

/** Traffic light + the decision word (lists, select mode). */
export function ReviewLevelPill({
  level,
  className,
}: {
  level: AccessReviewLevel;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5", className)}>
      <TrafficLight level={level} />
      <span className={cn("text-xs font-bold", VERDICT[level].text)}>{VERDICT[level].word}</span>
    </span>
  );
}

/**
 * Compact: under a request/renewal row. The light + decision word, one plain
 * sentence, and the picture of what happened — no wall of chips.
 */
export function AccessReviewLine({
  review,
  className,
  showNow = true,
}: {
  review: AccessReview;
  className?: string;
  /** End the trail with a "now — asking again" point (open requests). */
  showNow?: boolean;
}) {
  const v = VERDICT[review.level];
  return (
    <div className={cn("flex w-full flex-col gap-2", className)}>
      <div className="flex items-center gap-2">
        <TrafficLight level={review.level} />
        <div className="min-w-0">
          <p className={cn("text-sm leading-tight font-bold", v.text)}>{v.word}</p>
          <p className="text-xs leading-snug text-muted-foreground">{review.headline}</p>
        </div>
      </div>
      {/* A trail needs two points to say anything; one lone key is noise. */}
      {review.history.trail.length + (showNow ? 1 : 0) >= 2 ? (
        <AccessTrail review={review} showNow={showNow} />
      ) : null}
    </div>
  );
}

/**
 * Full: the box inside an approve / renew dialog and the customer profile —
 * the big light and word, the advice, four pictures with numbers, and the
 * dated trail.
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
  const v = VERDICT[review.level];
  return (
    <div
      role={review.level === "hold" ? "alert" : undefined}
      className={cn("@container rounded-xl border p-3", LEVEL[review.level].box, className)}
    >
      <div className="flex items-center gap-3">
        <TrafficLight level={review.level} size="lg" />
        <div className="min-w-0">
          <p className={cn("text-lg leading-tight font-extrabold", v.text)}>{v.word}</p>
          <p className="text-xs leading-snug text-foreground/80">{review.headline}</p>
        </div>
      </div>
      {review.advice ? (
        <p className="mt-2 text-xs font-medium text-muted-foreground">{review.advice}</p>
      ) : null}
      <div className="mt-3 space-y-3">
        <ReviewStats review={review} />
        {review.history.trail.length + (showNow ? 1 : 0) >= 2 ? (
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
const IST = "Asia/Kolkata";
const shortDate = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: IST });
const monthOnly = new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: IST });
const monthYear = new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: IST });
const longDate = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: IST,
});

/**
 * A run of identical points shown as ONE point with a count — "approved,
 * nothing" four times is one red key ×4. This is what keeps the trail the
 * same width whether a shop has 2 events or 200.
 */
interface TrailGroup {
  kind: TrailEvent["kind"];
  unused: boolean;
  events: TrailEvent[];
}

/** How many points a trail shows (older groups fold into "+N earlier"). */
const MAX_GROUPS = 5;

export function groupTrail(trail: readonly TrailEvent[]): TrailGroup[] {
  const groups: TrailGroup[] = [];
  for (const e of trail) {
    const unused = e.kind === "approval" && e.unused === true;
    const last = groups[groups.length - 1];
    if (last && last.kind === e.kind && last.unused === unused) last.events.push(e);
    else groups.push({ kind: e.kind, unused, events: [e] });
  }
  return groups;
}

function groupWhat(g: TrailGroup): string {
  const n = g.events.length;
  if (g.kind === "order") return n === 1 ? "Order placed" : `${n} orders`;
  if (g.unused) return n === 1 ? "Approved, no order after" : `Approved ${n} times, no order after`;
  return n === 1 ? "Approved, then ordered" : `Approved ${n} times, ordered after each`;
}

function groupWhen(g: TrailGroup, style: "short" | "long"): string {
  const first = new Date(g.events[0]!.at);
  const last = new Date(g.events[g.events.length - 1]!.at);
  if (g.events.length === 1) return (style === "long" ? longDate : shortDate).format(first);
  if (style === "long") return `${longDate.format(first)} – ${longDate.format(last)}`;
  const a = monthOnly.format(first);
  const b = monthOnly.format(last);
  const sameYear = first.getUTCFullYear() === last.getUTCFullYear();
  if (a === b && sameYear) return a;
  return sameYear ? `${a}–${b}` : `${monthYear.format(first)}–${monthYear.format(last)}`;
}

type Align = "start" | "center" | "end";
const ALIGN: Record<Align, string> = {
  start: "left-0",
  center: "left-1/2 -translate-x-1/2",
  end: "right-0",
};

/** Node sizes: 24px in a narrow container, 28px from 20rem (container query). */
const NODE = "size-6 @[20rem]:size-7";
const LINK_TOP = "mt-[11px] @[20rem]:mt-[13px]";

function TrailPoint({
  group,
  full,
  align,
}: {
  group: TrailGroup | "now";
  full: boolean;
  align: Align;
}) {
  let look: string;
  let Icon: React.ComponentType<{ className?: string }>;
  let note: string;
  let label: string;
  let count = 1;
  if (group === "now") {
    look = "border-2 border-dashed border-muted-foreground/60 bg-background text-muted-foreground";
    Icon = HourglassIcon;
    note = "Now · asking for prices";
    label = "Now";
  } else {
    count = group.events.length;
    note = `${groupWhat(group)} · ${groupWhen(group, "long")}`;
    label = groupWhen(group, "short");
    if (group.kind === "order") {
      look = "bg-success text-white";
      Icon = ShoppingCartIcon;
    } else if (group.unused) {
      look = "border-2 border-destructive bg-destructive/10 text-destructive";
      Icon = KeyRoundIcon;
    } else {
      look = "border-2 border-success bg-background text-success";
      Icon = KeyRoundIcon;
    }
  }
  return (
    <li className="group relative flex shrink-0 flex-col items-center">
      {/* tabIndex -1: a tap (phone) focuses it and shows the same note a
          mouse gets on hover, but a dialog's auto-focus never lands here.
          Keyboard and screen-reader users get the whole story from the
          list's own label. */}
      <span
        tabIndex={-1}
        aria-label={note}
        className={cn(
          "relative grid place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          NODE,
          look,
        )}
      >
        <Icon className="size-3 @[20rem]:size-3.5" aria-hidden />
        {count > 1 ? (
          <span
            className={cn(
              "absolute -top-1.5 -right-2 min-w-4 rounded-full px-1 text-center text-[9px] leading-4 font-bold tabular-nums ring-2 ring-card",
              group !== "now" && group.kind === "order"
                ? "bg-success text-white"
                : group !== "now" && group.unused
                  ? "bg-destructive text-white"
                  : "bg-foreground text-background",
            )}
          >
            ×{count}
          </span>
        ) : null}
      </span>
      {full ? (
        // Hangs under the point without widening it; the ends align inward
        // so nothing runs off a 320px screen.
        <span
          className={cn(
            "absolute top-full mt-1 text-[10px] leading-none whitespace-nowrap text-muted-foreground tabular-nums",
            ALIGN[align],
          )}
        >
          {label}
        </span>
      ) : null}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute bottom-full z-20 mb-2 hidden w-max max-w-[14rem] rounded-md bg-foreground px-2 py-1 text-[11px] leading-snug text-background shadow-md group-focus-within:block group-hover:block",
          ALIGN[align],
        )}
      >
        {note}
      </span>
    </li>
  );
}

/** The line between two points: red and dashed after unused approvals. */
function TrailLink({ dead }: { dead: boolean }) {
  return (
    <li
      aria-hidden
      className={cn(
        "min-w-2 flex-1 self-start",
        LINK_TOP,
        dead ? "border-t-2 border-dashed border-destructive/60" : "h-0.5 bg-border",
      )}
    />
  );
}

/**
 * The shop's story on one line, oldest → newest: approvals (key) and orders
 * (cart), with runs folded into one point "×N". An approval no order
 * followed is red, and so is the stretch after it — "approved, nothing,
 * approved, nothing" reads at a glance on any screen.
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
  const all = groupTrail(review.history.trail);
  const hiddenGroups = Math.max(0, all.length - MAX_GROUPS);
  const groups = all.slice(hiddenGroups);
  const earlier =
    review.history.trailEarlier + all.slice(0, hiddenGroups).reduce((n, g) => n + g.events.length, 0);
  const summary = [
    earlier ? `${earlier} earlier` : null,
    ...groups.map((g) => `${groupWhat(g)} (${groupWhen(g, "long")})`),
    showNow ? "now asking for prices" : null,
  ]
    .filter(Boolean)
    .join("; ");

  const points = (earlier ? 1 : 0) + groups.length + (showNow ? 1 : 0);
  const alignAt = (index: number): Align =>
    index === 0 ? "start" : index === points - 1 ? "end" : "center";
  const offset = earlier ? 1 : 0;

  return (
    <div className="@container space-y-2">
      <ol
        aria-label={`History: ${summary || "nothing yet"}`}
        className={cn("flex w-full items-start", full ? "pb-4" : "max-w-xs")}
      >
        {earlier > 0 ? (
          <>
            <li className="relative flex shrink-0 flex-col items-center">
              <span
                className={cn(
                  "grid place-items-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground tabular-nums",
                  NODE,
                )}
                aria-label={`${earlier} earlier`}
              >
                +{earlier}
              </span>
              {full ? (
                <span className="absolute top-full left-0 mt-1 text-[10px] leading-none whitespace-nowrap text-muted-foreground">
                  earlier
                </span>
              ) : null}
            </li>
            <TrailLink dead={false} />
          </>
        ) : null}
        {groups.map((g, i) => (
          <React.Fragment key={`${g.kind}-${g.events[0]!.at}`}>
            {i > 0 ? <TrailLink dead={groups[i - 1]!.unused} /> : null}
            <TrailPoint group={g} full={full} align={alignAt(i + offset)} />
          </React.Fragment>
        ))}
        {showNow ? (
          <>
            {groups.length > 0 ? <TrailLink dead={groups[groups.length - 1]!.unused} /> : null}
            <TrailPoint group="now" full={full} align={alignAt(points - 1)} />
          </>
        ) : null}
      </ol>
      {full && groups.length > 0 ? (
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

/** Up to this many approvals are drawn as keys; more becomes a number. */
const MAX_KEYS = 8;

/**
 * Four pictures with numbers: orders, last order, approvals (drawn as keys —
 * green before the last order, red after it), products looked at.
 */
export function ReviewStats({ review }: { review: AccessReview }) {
  const h = review.history;
  const wasted = h.approvalsSinceLastOrder;
  const kept = Math.max(0, h.approvalsTotal - wasted);
  const drawKeys = h.approvalsTotal > 0 && h.approvalsTotal <= MAX_KEYS;

  return (
    <dl className="grid grid-cols-2 gap-1.5 @[28rem]:grid-cols-4">
      <Stat
        icon={ShoppingCartIcon}
        iconClass={h.ordersTotal > 0 ? "bg-success text-white" : "bg-muted text-muted-foreground"}
        label="Orders"
        value={String(h.ordersTotal)}
      />
      <Stat
        icon={HourglassIcon}
        iconClass={
          h.lastOrderAt
            ? "bg-muted text-foreground"
            : h.approvalsTotal > 0
              ? "bg-destructive/15 text-destructive"
              : "bg-muted text-muted-foreground"
        }
        label="Last order"
        value={h.lastOrderAt ? agoLabel(h.lastOrderAt).replace(" days ago", "d ago") : "Never"}
      />
      <div className="rounded-lg border border-border/70 bg-background/70 px-2.5 py-2">
        <dt className="text-[11px] font-medium whitespace-nowrap text-muted-foreground">Approved</dt>
        <dd className="mt-1">
          {h.approvalsTotal === 0 ? (
            <span className="text-base font-semibold text-foreground">Never</span>
          ) : drawKeys ? (
            <span
              className="flex flex-wrap items-center gap-0.5"
              aria-label={`${h.approvalsTotal} approvals, ${wasted} with no order after`}
            >
              {Array.from({ length: kept }, (_, i) => (
                <KeyRoundIcon key={`k${i}`} className="size-4 text-success" aria-hidden />
              ))}
              {Array.from({ length: wasted }, (_, i) => (
                <KeyRoundIcon key={`w${i}`} className="size-4 text-destructive" aria-hidden />
              ))}
            </span>
          ) : (
            <span className="text-base font-semibold text-foreground tabular-nums">
              {h.approvalsTotal}×
            </span>
          )}
          {wasted > 0 ? (
            <span className="mt-0.5 block text-[10px] font-semibold text-destructive">
              {wasted} with no order
            </span>
          ) : null}
        </dd>
      </div>
      <Stat
        icon={EyeIcon}
        iconClass="bg-muted text-muted-foreground"
        label="Seen, 30d"
        value={String(h.viewsRecent)}
      />
    </dl>
  );
}

function Stat({
  icon: Icon,
  iconClass,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-2 py-2">
      <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", iconClass)}>
        <Icon className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0">
        <dt className="text-[11px] font-medium whitespace-nowrap text-muted-foreground">{label}</dt>
        <dd className="text-base leading-tight font-semibold text-foreground tabular-nums">{value}</dd>
      </div>
    </div>
  );
}
