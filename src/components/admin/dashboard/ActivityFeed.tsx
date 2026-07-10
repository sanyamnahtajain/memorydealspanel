import * as React from "react";
import {
  ArchiveRestore,
  CheckCircle2,
  FilePen,
  FilePlus2,
  KeyRound,
  KeySquare,
  LogIn,
  ShieldX,
  Trash2,
  UserPlus,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/common";

/**
 * One humanized audit-log entry. The server maps raw `AuditLog` rows into this
 * shape (see {@link humanizeAudit}) so the feed stays purely presentational.
 */
export interface ActivityItem {
  id: string;
  /** Verb-first sentence, e.g. "Created product". */
  title: string;
  /** Secondary detail, e.g. the entity id or a short diff summary. */
  detail?: string;
  /** ISO timestamp used for the relative "x ago" label and <time dateTime>. */
  timestamp: string;
  /** Semantic tone driving the icon tint. */
  tone: ActivityTone;
  icon: LucideIcon;
}

type ActivityTone = "neutral" | "positive" | "negative" | "warning";

const TONE_CLASSES: Record<ActivityTone, string> = {
  neutral: "bg-accent text-accent-foreground",
  positive: "bg-success/10 text-success",
  negative: "bg-destructive/10 text-destructive",
  warning: "bg-warning/15 text-warning-foreground dark:text-warning",
};

/* ------------------------------------------------------------------ */
/* Humanization (server-safe, no React)                                */
/* ------------------------------------------------------------------ */

interface RawAudit {
  id: string;
  actorType: string;
  actorId: string;
  action: string;
  entity: string;
  entityId: string;
  createdAt: Date;
}

interface ActionMeta {
  verb: string;
  tone: ActivityTone;
  icon: LucideIcon;
}

/**
 * Maps an audit `action` verb (the part after the dot, e.g. "create") to a
 * human verb, tone and icon. Falls back to a neutral, title-cased verb for
 * actions we do not explicitly know about, so new actions still render.
 */
const ACTION_META: Record<string, ActionMeta> = {
  create: { verb: "Created", tone: "positive", icon: FilePlus2 },
  update: { verb: "Updated", tone: "neutral", icon: FilePen },
  edit: { verb: "Updated", tone: "neutral", icon: FilePen },
  delete: { verb: "Deleted", tone: "negative", icon: Trash2 },
  restore: { verb: "Restored", tone: "positive", icon: ArchiveRestore },
  approve: { verb: "Approved", tone: "positive", icon: CheckCircle2 },
  reject: { verb: "Rejected", tone: "negative", icon: XCircle },
  block: { verb: "Blocked", tone: "negative", icon: ShieldX },
  grant: { verb: "Granted access to", tone: "positive", icon: KeyRound },
  revoke: { verb: "Revoked access for", tone: "warning", icon: KeySquare },
  login: { verb: "Signed in", tone: "neutral", icon: LogIn },
  register: { verb: "Registered", tone: "neutral", icon: UserPlus },
};

/**
 * Title-cases a bare identifier, splitting on separators and camel/Pascal-case
 * boundaries: "access_request" → "Access request", "AccessRequest" → "Access
 * request".
 */
function titleize(value: string): string {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .trim();
  if (!spaced) return value;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * Turns a raw audit row into a presentational {@link ActivityItem}. The
 * `action` is expected to be "<entity>.<verb>" (e.g. "product.create") but we
 * tolerate a bare verb or unknown verbs gracefully.
 */
export function humanizeAudit(row: RawAudit): ActivityItem {
  const verbKey = (row.action.includes(".")
    ? row.action.slice(row.action.lastIndexOf(".") + 1)
    : row.action
  ).toLowerCase();

  const meta = ACTION_META[verbKey];
  const entityLabel = titleize(row.entity).toLowerCase();

  const title = meta
    ? `${meta.verb} ${entityLabel}`
    : `${titleize(verbKey)} ${entityLabel}`;

  return {
    id: row.id,
    title,
    detail: shortId(row.entityId),
    timestamp: row.createdAt.toISOString(),
    tone: meta?.tone ?? "neutral",
    icon: meta?.icon ?? FilePen,
  };
}

/** Compact display of a Mongo ObjectId: first + last 4 hex chars. */
function shortId(id: string): string | undefined {
  if (!id || id.length <= 10) return id || undefined;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

/* ------------------------------------------------------------------ */
/* Relative time (deterministic, server-rendered)                      */
/* ------------------------------------------------------------------ */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Coarse "x ago" label computed against a fixed `now` passed from the server
 * render, keeping SSR and hydration deterministic.
 */
function relativeTime(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, now - then);
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) {
    const m = Math.floor(diff / MINUTE);
    return `${m}m ago`;
  }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return `${h}h ago`;
  }
  const d = Math.floor(diff / DAY);
  if (d < 7) return `${d}d ago`;
  return new Date(then).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

interface ActivityFeedProps {
  items: ActivityItem[];
  /**
   * Reference "now" (epoch ms) for relative labels, captured once at request
   * time by the caller. Required so this component stays render-pure.
   */
  now: number;
  className?: string;
}

/**
 * Recent-activity feed: a vertical list of humanized audit events with tinted
 * icons and relative timestamps. Server component. Shows an empty state when
 * there is nothing to display.
 */
export function ActivityFeed({ items, now, className }: ActivityFeedProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        illustration="no-results"
        title="No activity yet"
        description="Admin actions like product edits and access decisions will show up here."
        className={className}
      />
    );
  }

  return (
    <ol data-slot="activity-feed" className={cn("flex flex-col", className)}>
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <li
            key={item.id}
            className={cn(
              "flex items-start gap-3 py-3",
              index > 0 && "border-t border-border/60",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
                TONE_CLASSES[item.tone],
              )}
            >
              <Icon />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {item.title}
              </p>
              {item.detail ? (
                <p className="truncate font-tabular text-xs text-muted-foreground">
                  {item.detail}
                </p>
              ) : null}
            </div>
            <time
              dateTime={item.timestamp}
              className="shrink-0 pt-0.5 text-xs whitespace-nowrap text-muted-foreground"
            >
              {relativeTime(item.timestamp, now)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
