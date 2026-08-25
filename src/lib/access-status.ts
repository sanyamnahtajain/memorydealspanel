import type { CustomerStatus } from "@/lib/schemas/shared";

/**
 * THE single source of truth for "where does this customer stand?" copy
 * (owner request): four separate components each carried their own diverging
 * status switch — this module replaces all of them so every surface (account,
 * price gates, banner, sticky bar) says exactly the same thing.
 *
 * Pure: no server imports, usable from client and server alike.
 */

export type AccessState =
  | "anon" // not signed in
  | "pending" // signed in · request under review
  | "rejected" // signed in · last request declined
  | "expired" // signed in · APPROVED-but-lapsed or status EXPIRED
  | "expiring" // signed in · live access ending within the warning window
  | "active" // signed in · live access
  | "blocked"; // signed in · account blocked

/** Days before expiry at which the "place an order" nudge starts. */
export const EXPIRY_WARN_DAYS = 7;

export interface AccessSnapshot {
  signedIn: boolean;
  status?: CustomerStatus;
  /** Live price access right now (status APPROVED + unexpired grant). */
  priceAccess?: boolean;
  /** Effective expiry of the live access (ISO), null/undefined = unlimited. */
  expiresAt?: string | null;
  /** An open (PENDING/SNOOZED) AccessRequest exists. */
  hasOpenRequest?: boolean;
}

/** Whole days until `iso` (ceil; negative = past). */
export function daysUntil(iso: string, now: Date = new Date()): number {
  return Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000);
}

/** Resolve the snapshot to the ONE state every surface renders from. */
export function resolveAccessState(snap: AccessSnapshot, now: Date = new Date()): AccessState {
  if (!snap.signedIn) return "anon";
  switch (snap.status) {
    case "BLOCKED":
      return "blocked";
    case "PENDING":
      return "pending";
    case "REJECTED":
      // A fresh open request supersedes the old rejection.
      return snap.hasOpenRequest ? "pending" : "rejected";
    case "EXPIRED":
      return snap.hasOpenRequest ? "pending" : "expired";
    case "APPROVED": {
      if (!snap.priceAccess) return snap.hasOpenRequest ? "pending" : "expired";
      if (snap.expiresAt) {
        const days = daysUntil(snap.expiresAt, now);
        if (days <= EXPIRY_WARN_DAYS) return "expiring";
      }
      return "active";
    }
    default:
      return "anon";
  }
}

export interface AccessCopy {
  /** Short chip/badge label. */
  chip: string;
  /** Headline. */
  title: string;
  /** One friendly sentence. `{days}` is replaced for the expiring state. */
  body: string;
  /** Visual tone for chips/banners. */
  tone: "neutral" | "info" | "warning" | "destructive" | "success";
  /** The ONE action that makes sense from here. */
  cta: "request-access" | "renew" | "browse" | null;
  ctaLabel: string | null;
}

/**
 * SIMPLE ENGLISH ONLY (owner request — many customers read basic English):
 * short sentences, everyday words, no trade jargon. Say what happened and
 * what to tap next. Nothing here may tell a signed-in person to "log in".
 */
const COPY: Record<AccessState, AccessCopy> = {
  anon: {
    chip: "Not signed in",
    title: "Sign in to see prices",
    body: "Only approved shops can see prices. Sign in with Google to start.",
    tone: "neutral",
    cta: "request-access",
    ctaLabel: "Sign in with Google",
  },
  pending: {
    chip: "Being checked",
    title: "You are signed in. We are checking your request.",
    body: "We will tell you when it is approved. This usually takes one day.",
    tone: "info",
    cta: null,
    ctaLabel: null,
  },
  rejected: {
    chip: "Not approved",
    title: "You are signed in, but your request was not approved.",
    body: "You can ask again. Tap the button and we will check one more time.",
    tone: "warning",
    cta: "renew",
    ctaLabel: "Ask again",
  },
  expired: {
    chip: "Access ended",
    title: "You are signed in, but your price access has ended.",
    body: "Tap the button to ask for access again. No form to fill — one tap is enough.",
    tone: "warning",
    cta: "renew",
    ctaLabel: "Get access again",
  },
  expiring: {
    chip: "Ending soon",
    title: "Your prices will stop in {days}",
    body: "Place one order before that and you get 30 more days free. No order — prices stop.",
    tone: "warning",
    cta: "browse",
    ctaLabel: "See products",
  },
  active: {
    chip: "Approved",
    title: "You can see all prices",
    body: "Your shop is approved. All prices are open for you.",
    tone: "success",
    cta: null,
    ctaLabel: null,
  },
  blocked: {
    chip: "Blocked",
    title: "Your account is blocked.",
    body: "Please talk to the shop if you think this is wrong.",
    tone: "destructive",
    cta: null,
    ctaLabel: null,
  },
};

/** Copy for a state, with `{days}` filled from the snapshot when relevant. */
export function accessCopy(
  state: AccessState,
  snap?: AccessSnapshot,
  /**
   * Clock to count from, matching `resolveAccessState(snap, now)`. Defaults to
   * the real time. Without this the day count could not be pinned in a test:
   * one pinned an expiry to a fixed date, let this read the wall clock, and
   * silently started failing the day real time drifted past that date.
   */
  now: Date = new Date(),
): AccessCopy {
  const base = COPY[state];
  if (state !== "expiring" || !snap?.expiresAt) return base;
  const days = Math.max(0, daysUntil(snap.expiresAt, now));
  const human = days === 0 ? "less than a day" : days === 1 ? "1 day" : `${days} days`;
  return { ...base, title: base.title.replace("{days}", human) };
}
