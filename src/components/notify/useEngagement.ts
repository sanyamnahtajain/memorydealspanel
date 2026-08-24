"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import {
  EMPTY_LEDGER,
  recordAction,
  recordAsk,
  recordDecline,
  recordSatisfied,
  recordVisit,
  resetPrompt,
  shouldPrompt,
  type EngagementLedger,
  type EngagementSignal,
  type PermissionState,
  type PromptDecision,
  type PromptKind,
} from "@/lib/notify/engagement";

/**
 * Persistence + wiring for the re-ask algorithm in
 * `src/lib/notify/engagement.ts`. All the decision rules live there (pure and
 * unit-tested); this hook only stores the ledger and feeds it live browser
 * facts.
 *
 * WHY LOCAL STORAGE, not the database: both prompts are properties of a
 * DEVICE, not a person. "Is the app installed" and "did this browser allow
 * notifications" differ between the buyer's phone and their shop computer, and
 * a server-side counter would nag them on the device where they already said
 * yes. Local storage is also readable without a round trip, so the decision is
 * made before first paint and never flashes a prompt at someone who dismissed
 * it.
 *
 * Every storage access is wrapped: Safari private mode and locked-down
 * in-app browsers throw on localStorage, and a notification nudge must never
 * take the page down with it.
 */

/**
 * The storefront and the admin panel are separate apps with separate
 * installs, and in practice separate PEOPLE — a buyer on their phone, staff
 * on the shop machine. They therefore get separate ledgers: staff dismissing
 * the admin install nag must not silence the buyer's, and a buyer's browsing
 * must not count as staff engagement.
 */
export type EngagementScope = "storefront" | "admin";

function ledgerKey(scope: EngagementScope): string {
  return scope === "admin" ? "md-engagement-v1:admin" : "md-engagement-v1";
}

/** Per-visit flag: at most one interruption per session, across all prompts. */
const SESSION_FLAG = "md-prompted-this-session";

function readLedger(scope: EngagementScope): EngagementLedger {
  if (typeof window === "undefined") return EMPTY_LEDGER;
  try {
    const raw = window.localStorage.getItem(ledgerKey(scope));
    if (!raw) return EMPTY_LEDGER;
    const parsed = JSON.parse(raw) as Partial<EngagementLedger>;
    // Merge over the empty ledger so a truncated or older blob still yields a
    // complete, well-typed object.
    return {
      ...EMPTY_LEDGER,
      ...parsed,
      lastAskAt: parsed.lastAskAt ?? {},
      declines: parsed.declines ?? {},
      satisfied: parsed.satisfied ?? {},
    };
  } catch {
    return EMPTY_LEDGER;
  }
}

function writeLedger(scope: EngagementScope, ledger: EngagementLedger): void {
  try {
    window.localStorage.setItem(ledgerKey(scope), JSON.stringify(ledger));
  } catch {
    /* storage unavailable — the ledger simply won't persist */
  }
}

function readSessionFlag(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_FLAG) === "1";
  } catch {
    return false;
  }
}

function writeSessionFlag(): void {
  try {
    window.sessionStorage.setItem(SESSION_FLAG, "1");
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* the ledger store                                                    */
/* ------------------------------------------------------------------ */

/**
 * The ledger is external state (it lives in localStorage), so it is exposed
 * through `useSyncExternalStore` rather than component state. That is not a
 * style choice: reading it into `useState` inside an effect would mean an
 * extra render on every mount, and this hook mounts on every page of both
 * apps.
 *
 * The cache also keeps the two surfaces' ledgers separate and lets several
 * mounted consumers (the install card and the notification card both use it)
 * see the same value without racing each other's writes.
 */
type Listener = () => void;

const cache = new Map<EngagementScope, EngagementLedger>();
const listeners = new Map<EngagementScope, Set<Listener>>();

function snapshot(scope: EngagementScope): EngagementLedger {
  let value = cache.get(scope);
  if (!value) {
    value = readLedger(scope);
    cache.set(scope, value);
  }
  return value;
}

function publish(scope: EngagementScope, next: EngagementLedger): void {
  cache.set(scope, next);
  writeLedger(scope, next);
  for (const listener of listeners.get(scope) ?? []) listener();
}

function subscribeTo(scope: EngagementScope, listener: Listener): () => void {
  let set = listeners.get(scope);
  if (!set) {
    set = new Set();
    listeners.set(scope, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

/** No-op subscription — the "we are on the client now" flag never changes. */
function subscribeNoop(): () => void {
  return () => {};
}

export interface EngagementApi {
  /** True once we are on the client and the ledger is readable. */
  ready: boolean;
  ledger: EngagementLedger;
  /** Ask the algorithm whether to show one prompt right now. */
  decide: (
    kind: PromptKind,
    context: {
      installed: boolean;
      permission: PermissionState;
      iosNeedsInstall: boolean;
      signal?: EngagementSignal;
    },
  ) => PromptDecision;
  /** Record that a prompt was shown (also burns this session's one ask). */
  markAsked: (kind: PromptKind) => void;
  /** Record a "no" — moves the prompt down the backoff ladder. */
  markDeclined: (kind: PromptKind) => void;
  /** Record a "yes" — this prompt is finished on this device. */
  markSatisfied: (kind: PromptKind) => void;
  /** Record a meaningful action (order placed, access requested). */
  markAction: () => void;
  /** Re-arm a prompt from scratch (used by the manual settings toggles). */
  reset: (kind: PromptKind) => void;
}

export function useEngagement(
  scope: EngagementScope = "storefront",
): EngagementApi {
  const pathname = usePathname() ?? "/";
  const promptedRef = React.useRef(false);

  const subscribe = React.useCallback(
    (listener: Listener) => subscribeTo(scope, listener),
    [scope],
  );

  const ledger = React.useSyncExternalStore(
    subscribe,
    () => snapshot(scope),
    () => EMPTY_LEDGER,
  );

  // `false` during SSR and the first paint, `true` after — so nothing decides
  // to prompt before the stored ledger is actually readable.
  const ready = React.useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  // Count this visit. Writing to the external store (not component state)
  // keeps this a genuine "sync React with an outside system" effect.
  React.useEffect(() => {
    promptedRef.current = readSessionFlag();
    publish(scope, recordVisit(snapshot(scope), Date.now()));
  }, [scope]);

  const decide = React.useCallback<EngagementApi["decide"]>(
    (kind, context) =>
      shouldPrompt({
        kind,
        now: Date.now(),
        ledger: snapshot(scope),
        pathname,
        installed: context.installed,
        permission: context.permission,
        iosNeedsInstall: context.iosNeedsInstall,
        promptedThisSession: promptedRef.current,
        signal: context.signal ?? null,
      }),
    [pathname, scope],
  );

  const markAsked = React.useCallback(
    (kind: PromptKind) => {
      promptedRef.current = true;
      writeSessionFlag();
      publish(scope, recordAsk(snapshot(scope), kind, Date.now()));
    },
    [scope],
  );

  const markDeclined = React.useCallback(
    (kind: PromptKind) => {
      publish(scope, recordDecline(snapshot(scope), kind, Date.now()));
    },
    [scope],
  );

  const markSatisfiedCb = React.useCallback(
    (kind: PromptKind) => {
      publish(scope, recordSatisfied(snapshot(scope), kind));
    },
    [scope],
  );

  const markAction = React.useCallback(() => {
    publish(scope, recordAction(snapshot(scope), Date.now()));
  }, [scope]);

  const reset = React.useCallback(
    (kind: PromptKind) => {
      publish(scope, resetPrompt(snapshot(scope), kind));
    },
    [scope],
  );

  return {
    ready,
    ledger,
    decide,
    markAsked,
    markDeclined,
    markSatisfied: markSatisfiedCb,
    markAction,
    reset,
  };
}

/**
 * Record a meaningful action from anywhere (a server-action success handler,
 * a confirmation page) without mounting the hook. Placing an order is the
 * strongest signal we have that this person is worth asking.
 */
export function noteEngagementAction(
  scope: EngagementScope = "storefront",
): void {
  if (typeof window === "undefined") return;
  publish(scope, recordAction(snapshot(scope), Date.now()));
}
