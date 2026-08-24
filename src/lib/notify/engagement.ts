/**
 * The re-ask brain (owner request: "sometimes we skip the install notice,
 * sometimes we decline notifications — re-ask timely, frequently, based on
 * how the user actually uses the app").
 *
 * Two prompts compete for the same scarce resource — the buyer's patience:
 *   - "install"  — add the app to the home screen
 *   - "notify"   — allow notifications
 *
 * Asking too early wastes the ask (a first-time visitor says no to
 * everything). Asking too often turns into spam and gets the app muted for
 * good. So the decision is a pure function of a small usage ledger, and every
 * rule below exists to answer one question: *has this person shown enough
 * interest that the ask is welcome, and has enough time passed since the last
 * one?*
 *
 * This module is deliberately pure and dependency-free: it never touches
 * `window`, so it is unit-testable and can also run on the server later
 * (e.g. to decide whether an email nudge is due).
 */

export type PromptKind = "install" | "notify";

/** How the browser currently stands on notification permission. */
export type PermissionState = "default" | "granted" | "denied" | "unsupported";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Backoff after each decline, in days. The user asked to keep re-asking, so
 * the ladder never reaches "never" — it flattens out at ~3 months, which is
 * roughly the cadence of a buyer re-evaluating an app they kept using anyway.
 */
export const DECLINE_BACKOFF_DAYS = [3, 7, 21, 45, 90] as const;

/**
 * A permission the browser has hard-denied cannot be re-requested by script —
 * only the user can undo it in site settings. So we stop prompting and very
 * occasionally show a "how to turn this on" explainer instead.
 */
export const HOWTO_BACKOFF_DAYS = [14, 45, 90] as const;

/** Never ask before the user has shown this much interest. */
export const WARMUP = {
  /** Distinct visits (a visit = a gap of >30 min since the last activity). */
  sessions: 2,
  /** …or one real action, which outranks any amount of idle browsing. */
  actions: 1,
} as const;

/** Never two asks closer together than this, whatever the signal. */
export const MIN_GAP_MS = 1 * DAY;

/**
 * The usage ledger. Persisted per device (localStorage) because both prompts
 * are per-device facts: an app installed on the phone says nothing about the
 * desktop, and notification permission is per browser.
 */
export interface EngagementLedger {
  /** First time we ever saw this device. */
  firstSeenAt: number;
  /** Number of distinct visits. */
  sessions: number;
  /** Meaningful actions taken (orders placed, access requested). */
  actions: number;
  /** Last activity timestamp, used to segment visits into sessions. */
  lastSeenAt: number;
  /** Per-prompt: when we last asked. */
  lastAskAt: Partial<Record<PromptKind, number>>;
  /** Per-prompt: how many times the user said no. */
  declines: Partial<Record<PromptKind, number>>;
  /** Per-prompt: the user settled it for good (installed / granted). */
  satisfied: Partial<Record<PromptKind, boolean>>;
}

export const EMPTY_LEDGER: EngagementLedger = {
  firstSeenAt: 0,
  sessions: 0,
  actions: 0,
  lastSeenAt: 0,
  lastAskAt: {},
  declines: {},
  satisfied: {},
};

/**
 * A moment that makes the ask land better than it would cold. After placing
 * an order the buyer wants to know what happens next; when access is about to
 * end, a reminder is genuinely useful. These halve the remaining wait.
 */
export type EngagementSignal = "orderPlaced" | "accessEnding" | null;

export interface PromptContext {
  kind: PromptKind;
  now: number;
  ledger: EngagementLedger;
  /** Current route — used only to stay out of the way at the wrong moment. */
  pathname: string;
  /** The app is already installed / running standalone. */
  installed: boolean;
  /** Browser notification permission (for kind === "notify"). */
  permission: PermissionState;
  /**
   * iOS only grants web push to an INSTALLED PWA. When true, asking for
   * notifications in the browser tab is guaranteed to fail, so the install
   * prompt must win first.
   */
  iosNeedsInstall: boolean;
  /** Another prompt already showed in this visit. */
  promptedThisSession: boolean;
  signal?: EngagementSignal;
}

export type PromptMode =
  /** Ask for the thing (native install prompt / permission request). */
  | "prompt"
  /** Permission is hard-denied: explain how to switch it on by hand. */
  | "howto";

export interface PromptDecision {
  ask: boolean;
  mode: PromptMode;
  /** Short machine-ish reason, for debugging and telemetry. */
  reason: string;
  /** When this prompt becomes eligible again; null when never. */
  nextEligibleAt: number | null;
}

function deny(reason: string, nextEligibleAt: number | null = null): PromptDecision {
  return { ask: false, mode: "prompt", reason, nextEligibleAt };
}

/**
 * Paths where an overlay would interrupt something the user is trying to
 * finish. Money and sign-in flows are sacred; nothing pops up over them.
 */
export function isQuietPath(pathname: string): boolean {
  return (
    pathname.startsWith("/account/cart") ||
    pathname.startsWith("/account/orders/confirmation") ||
    pathname.startsWith("/account/login") ||
    pathname.startsWith("/account/request-access") ||
    pathname.startsWith("/auth/")
  );
}

/** Has the user done enough for an ask to be fair? */
export function isWarmedUp(ledger: EngagementLedger): boolean {
  return (
    ledger.sessions >= WARMUP.sessions || ledger.actions >= WARMUP.actions
  );
}

/** The wait owed after `declineCount` refusals, in milliseconds. */
export function backoffMs(declineCount: number, ladder: readonly number[]): number {
  if (declineCount <= 0) return 0;
  const index = Math.min(declineCount, ladder.length) - 1;
  return ladder[index] * DAY;
}

/**
 * Decide whether to show one prompt right now.
 *
 * The order of the guards matters: cheap disqualifiers first (already done,
 * unsupported, wrong moment), then the engagement gate, then timing.
 */
export function shouldPrompt(context: PromptContext): PromptDecision {
  const { kind, now, ledger, permission } = context;

  // 1. Already settled — never ask again.
  if (kind === "install" && context.installed) {
    return deny("already-installed");
  }
  if (ledger.satisfied[kind]) return deny("already-satisfied");
  if (kind === "notify" && permission === "granted") {
    return deny("already-granted");
  }
  if (kind === "notify" && permission === "unsupported") {
    return deny("unsupported");
  }

  // 2. On iOS, notifications simply do not exist outside the installed app —
  //    asking would be a dead end, so we defer to the install prompt.
  if (kind === "notify" && context.iosNeedsInstall && !context.installed) {
    return deny("ios-needs-install-first");
  }

  // 3. One interruption per visit, and never mid-checkout or mid-login.
  if (context.promptedThisSession) return deny("already-prompted-this-session");
  if (isQuietPath(context.pathname)) return deny("quiet-path");

  // 4. Earn the ask.
  if (!isWarmedUp(ledger)) return deny("not-warmed-up");

  // 5. A hard denial cannot be re-requested by script. Fall back to the
  //    slower "here is how to switch it on yourself" explainer.
  const denied = kind === "notify" && permission === "denied";
  const ladder = denied ? HOWTO_BACKOFF_DAYS : DECLINE_BACKOFF_DAYS;
  const mode: PromptMode = denied ? "howto" : "prompt";

  // 6. Timing. Never asked before => go, as soon as warmed up.
  const lastAskAt = ledger.lastAskAt[kind] ?? 0;
  if (!lastAskAt) return { ask: true, mode, reason: "first-ask", nextEligibleAt: null };

  const declines = ledger.declines[kind] ?? 0;
  let wait = backoffMs(declines, ladder);

  // A high-value moment halves the remaining wait — but the floor still holds,
  // so a burst of orders can never turn into a burst of prompts.
  if (context.signal) wait = wait / 2;
  wait = Math.max(wait, MIN_GAP_MS);

  const eligibleAt = lastAskAt + wait;
  if (now < eligibleAt) {
    return {
      ask: false,
      mode,
      reason: context.signal ? "backoff-signal-boosted" : "backoff",
      nextEligibleAt: eligibleAt,
    };
  }

  return {
    ask: true,
    mode,
    reason: context.signal ? "due-signal-boosted" : "due",
    nextEligibleAt: null,
  };
}

// ---------------------------------------------------------------------------
// Ledger transitions (pure — the caller persists the result).
// ---------------------------------------------------------------------------

/** Gap after which a new visit counts as a new session. */
export const SESSION_GAP_MS = 30 * 60 * 1000;

/** Record a page view, rolling the session counter when the gap is big. */
export function recordVisit(
  ledger: EngagementLedger,
  now: number,
): EngagementLedger {
  const isNewSession =
    ledger.lastSeenAt === 0 || now - ledger.lastSeenAt > SESSION_GAP_MS;
  return {
    ...ledger,
    firstSeenAt: ledger.firstSeenAt || now,
    lastSeenAt: now,
    sessions: ledger.sessions + (isNewSession ? 1 : 0),
  };
}

/** Record a meaningful action (order placed, access requested). */
export function recordAction(
  ledger: EngagementLedger,
  now: number,
): EngagementLedger {
  return { ...ledger, actions: ledger.actions + 1, lastSeenAt: now };
}

/** Record that we showed the prompt (regardless of the answer). */
export function recordAsk(
  ledger: EngagementLedger,
  kind: PromptKind,
  now: number,
): EngagementLedger {
  return { ...ledger, lastAskAt: { ...ledger.lastAskAt, [kind]: now } };
}

/** Record a "no". Moves the prompt one rung down the backoff ladder. */
export function recordDecline(
  ledger: EngagementLedger,
  kind: PromptKind,
  now: number,
): EngagementLedger {
  return {
    ...ledger,
    lastAskAt: { ...ledger.lastAskAt, [kind]: now },
    declines: { ...ledger.declines, [kind]: (ledger.declines[kind] ?? 0) + 1 },
  };
}

/** Record a "yes" — the prompt is done for good on this device. */
export function recordSatisfied(
  ledger: EngagementLedger,
  kind: PromptKind,
): EngagementLedger {
  return { ...ledger, satisfied: { ...ledger.satisfied, [kind]: true } };
}

/**
 * Turning the feature off by hand (the manual toggle in settings) re-arms the
 * ladder from scratch: the user is in control, so a later change of mind
 * should not be buried under a 90-day backoff.
 */
export function resetPrompt(
  ledger: EngagementLedger,
  kind: PromptKind,
): EngagementLedger {
  const lastAskAt = { ...ledger.lastAskAt };
  const declines = { ...ledger.declines };
  const satisfied = { ...ledger.satisfied };
  delete lastAskAt[kind];
  delete declines[kind];
  delete satisfied[kind];
  return { ...ledger, lastAskAt, declines, satisfied };
}
