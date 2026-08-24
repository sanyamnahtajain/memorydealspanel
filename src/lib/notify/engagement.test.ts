import { describe, expect, it } from "vitest";

import {
  DECLINE_BACKOFF_DAYS,
  EMPTY_LEDGER,
  HOWTO_BACKOFF_DAYS,
  MIN_GAP_MS,
  SESSION_GAP_MS,
  backoffMs,
  isQuietPath,
  isWarmedUp,
  recordAction,
  recordAsk,
  recordDecline,
  recordSatisfied,
  recordVisit,
  resetPrompt,
  shouldPrompt,
  type EngagementLedger,
  type PromptContext,
} from "./engagement";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_750_000_000_000; // fixed instant; nothing here reads the clock

/** A ledger of someone who has used the shop enough to deserve an ask. */
function warmLedger(overrides: Partial<EngagementLedger> = {}): EngagementLedger {
  return {
    ...EMPTY_LEDGER,
    firstSeenAt: NOW - 10 * DAY,
    lastSeenAt: NOW - DAY,
    sessions: 4,
    actions: 1,
    ...overrides,
  };
}

function context(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    kind: "notify",
    now: NOW,
    ledger: warmLedger(),
    pathname: "/",
    installed: true,
    permission: "default",
    iosNeedsInstall: false,
    promptedThisSession: false,
    signal: null,
    ...overrides,
  };
}

describe("engagement — earning the ask", () => {
  it("does not ask a first-time visitor anything", () => {
    const fresh = { ...EMPTY_LEDGER, sessions: 1, lastSeenAt: NOW };
    expect(isWarmedUp(fresh)).toBe(false);

    const decision = shouldPrompt(context({ ledger: fresh }));
    expect(decision.ask).toBe(false);
    expect(decision.reason).toBe("not-warmed-up");
  });

  it("a second visit is enough to warm up", () => {
    const ledger = { ...EMPTY_LEDGER, sessions: 2, lastSeenAt: NOW };
    expect(isWarmedUp(ledger)).toBe(true);
    expect(shouldPrompt(context({ ledger })).ask).toBe(true);
  });

  it("one real action outranks idle browsing", () => {
    // A single session, but they placed an order — that is the strongest
    // signal we have, so it alone qualifies.
    const ledger = { ...EMPTY_LEDGER, sessions: 1, actions: 1, lastSeenAt: NOW };
    expect(isWarmedUp(ledger)).toBe(true);
    expect(shouldPrompt(context({ ledger })).ask).toBe(true);
  });

  it("the very first eligible ask is immediate, not delayed by backoff", () => {
    const decision = shouldPrompt(context());
    expect(decision).toMatchObject({ ask: true, reason: "first-ask" });
  });
});

describe("engagement — staying out of the way", () => {
  it.each([
    "/account/cart",
    "/account/orders/confirmation",
    "/account/login",
    "/account/request-access",
    "/auth/google/callback",
  ])("never interrupts %s", (pathname) => {
    expect(isQuietPath(pathname)).toBe(true);
    expect(shouldPrompt(context({ pathname })).ask).toBe(false);
  });

  it("browsing pages are fair game", () => {
    expect(isQuietPath("/")).toBe(false);
    expect(isQuietPath("/account")).toBe(false);
    expect(isQuietPath("/p/some-product")).toBe(false);
  });

  it("allows only one interruption per visit", () => {
    const decision = shouldPrompt(context({ promptedThisSession: true }));
    expect(decision.ask).toBe(false);
    expect(decision.reason).toBe("already-prompted-this-session");
  });
});

describe("engagement — nothing left to ask for", () => {
  it("never asks to install an installed app", () => {
    const decision = shouldPrompt(context({ kind: "install", installed: true }));
    expect(decision).toMatchObject({ ask: false, reason: "already-installed" });
  });

  it("never asks for permission that is already granted", () => {
    const decision = shouldPrompt(context({ permission: "granted" }));
    expect(decision).toMatchObject({ ask: false, reason: "already-granted" });
  });

  it("stays quiet where the browser cannot do notifications at all", () => {
    const decision = shouldPrompt(context({ permission: "unsupported" }));
    expect(decision).toMatchObject({ ask: false, reason: "unsupported" });
  });

  it("does not re-ask a prompt the user already satisfied", () => {
    const ledger = recordSatisfied(warmLedger(), "notify");
    expect(shouldPrompt(context({ ledger })).reason).toBe("already-satisfied");
  });
});

describe("engagement — iOS ordering", () => {
  it("defers the notification ask until the app is installed", () => {
    // On iOS web push simply does not exist outside an installed PWA, so
    // asking in the browser tab would be a guaranteed dead end.
    const decision = shouldPrompt(
      context({ iosNeedsInstall: true, installed: false }),
    );
    expect(decision).toMatchObject({
      ask: false,
      reason: "ios-needs-install-first",
    });
  });

  it("asks normally once the iOS app is installed", () => {
    const decision = shouldPrompt(
      context({ iosNeedsInstall: true, installed: true }),
    );
    expect(decision.ask).toBe(true);
  });

  it("still offers the install prompt on iOS", () => {
    const decision = shouldPrompt(
      context({ kind: "install", iosNeedsInstall: true, installed: false }),
    );
    expect(decision.ask).toBe(true);
  });
});

describe("engagement — the backoff ladder", () => {
  it("widens with each decline and then flattens, never reaching 'never'", () => {
    expect(backoffMs(0, DECLINE_BACKOFF_DAYS)).toBe(0);
    expect(backoffMs(1, DECLINE_BACKOFF_DAYS)).toBe(3 * DAY);
    expect(backoffMs(2, DECLINE_BACKOFF_DAYS)).toBe(7 * DAY);
    expect(backoffMs(3, DECLINE_BACKOFF_DAYS)).toBe(21 * DAY);
    expect(backoffMs(4, DECLINE_BACKOFF_DAYS)).toBe(45 * DAY);
    expect(backoffMs(5, DECLINE_BACKOFF_DAYS)).toBe(90 * DAY);
    // The owner asked us to keep asking: after many refusals the wait caps
    // instead of disabling the prompt forever.
    expect(backoffMs(99, DECLINE_BACKOFF_DAYS)).toBe(90 * DAY);
  });

  it("holds the user to the wait after a decline", () => {
    const ledger = warmLedger({
      lastAskAt: { notify: NOW - 2 * DAY },
      declines: { notify: 1 },
    });
    const decision = shouldPrompt(context({ ledger }));
    expect(decision.ask).toBe(false);
    expect(decision.reason).toBe("backoff");
    expect(decision.nextEligibleAt).toBe(NOW - 2 * DAY + 3 * DAY);
  });

  it("asks again once the wait has elapsed", () => {
    const ledger = warmLedger({
      lastAskAt: { notify: NOW - 4 * DAY },
      declines: { notify: 1 },
    });
    expect(shouldPrompt(context({ ledger }))).toMatchObject({
      ask: true,
      reason: "due",
    });
  });

  it("keeps re-asking a stubborn decliner, just rarely", () => {
    const ledger = warmLedger({
      lastAskAt: { notify: NOW - 91 * DAY },
      declines: { notify: 12 },
    });
    expect(shouldPrompt(context({ ledger })).ask).toBe(true);
  });
});

describe("engagement — high-value moments", () => {
  it("halves the remaining wait after a meaningful event", () => {
    // 4 days into a 7-day wait: normally too early, but the buyer just placed
    // an order, which is exactly when order alerts are worth having.
    const ledger = warmLedger({
      lastAskAt: { notify: NOW - 4 * DAY },
      declines: { notify: 2 },
    });
    expect(shouldPrompt(context({ ledger })).ask).toBe(false);
    expect(
      shouldPrompt(context({ ledger, signal: "orderPlaced" })),
    ).toMatchObject({ ask: true, reason: "due-signal-boosted" });
  });

  it("never lets a burst of events become a burst of prompts", () => {
    // Shown 2 hours ago and never actually refused (the user reloaded past
    // it), so the ladder owes no wait at all. The one-day floor is the only
    // thing standing between three quick orders and three prompts.
    const twoHoursAgo = NOW - 2 * 60 * 60 * 1000;
    const ledger = warmLedger({ lastAskAt: { notify: twoHoursAgo } });

    const decision = shouldPrompt(context({ ledger, signal: "orderPlaced" }));
    expect(decision.ask).toBe(false);
    expect(decision.nextEligibleAt).toBe(twoHoursAgo + MIN_GAP_MS);
  });

  it("halves the wait but does not discard it", () => {
    // One decline owes 3 days; a signal cuts that to 1.5, not to zero.
    const twoHoursAgo = NOW - 2 * 60 * 60 * 1000;
    const ledger = warmLedger({
      lastAskAt: { notify: twoHoursAgo },
      declines: { notify: 1 },
    });

    const decision = shouldPrompt(context({ ledger, signal: "orderPlaced" }));
    expect(decision.ask).toBe(false);
    expect(decision.nextEligibleAt).toBe(twoHoursAgo + 1.5 * DAY);
  });
});

describe("engagement — hard-denied permission", () => {
  it("switches to the how-to explainer on its own slower ladder", () => {
    // A denied permission cannot be re-requested by script, so asking again
    // would do nothing at all — we explain where the switch lives instead.
    const ledger = warmLedger({
      lastAskAt: { notify: NOW - 20 * DAY },
      declines: { notify: 1 },
    });
    const decision = shouldPrompt(context({ ledger, permission: "denied" }));
    expect(decision.mode).toBe("howto");
    expect(decision.ask).toBe(true);
    expect(HOWTO_BACKOFF_DAYS[0]).toBe(14);
  });

  it("waits much longer between explainers than between asks", () => {
    const ledger = warmLedger({
      lastAskAt: { notify: NOW - 5 * DAY },
      declines: { notify: 1 },
    });
    // 5 days would already be due on the normal ladder (3 days)…
    expect(shouldPrompt(context({ ledger })).ask).toBe(true);
    // …but the how-to ladder starts at 14 days.
    expect(shouldPrompt(context({ ledger, permission: "denied" })).ask).toBe(
      false,
    );
  });
});

describe("engagement — ledger transitions", () => {
  it("counts a new session only after a real gap", () => {
    const first = recordVisit(EMPTY_LEDGER, NOW);
    expect(first.sessions).toBe(1);
    expect(first.firstSeenAt).toBe(NOW);

    // Same visit, a few minutes later — still one session.
    const sameVisit = recordVisit(first, NOW + 5 * 60 * 1000);
    expect(sameVisit.sessions).toBe(1);

    // Came back long after the last activity — that is a second session. The
    // gap is measured from the last page view, not from the first one.
    const later = recordVisit(
      sameVisit,
      sameVisit.lastSeenAt + SESSION_GAP_MS + 1000,
    );
    expect(later.sessions).toBe(2);
  });

  it("records asks, declines and satisfaction independently per prompt", () => {
    let ledger = warmLedger();
    ledger = recordAsk(ledger, "install", NOW);
    ledger = recordDecline(ledger, "install", NOW);

    expect(ledger.declines.install).toBe(1);
    // The notification prompt is untouched by an install refusal.
    expect(ledger.declines.notify).toBeUndefined();
    expect(shouldPrompt(context({ kind: "notify", ledger })).ask).toBe(true);
  });

  it("counts actions without inventing sessions", () => {
    const ledger = recordAction(warmLedger({ actions: 0 }), NOW);
    expect(ledger.actions).toBe(1);
    expect(ledger.lastSeenAt).toBe(NOW);
  });

  it("re-arms a prompt from scratch when the user asks for it by hand", () => {
    // Someone who turned alerts off in settings and later changes their mind
    // should not be buried under a 90-day backoff.
    let ledger = warmLedger({
      lastAskAt: { notify: NOW - DAY },
      declines: { notify: 5 },
    });
    ledger = recordSatisfied(ledger, "notify");

    const rearmed = resetPrompt(ledger, "notify");
    expect(rearmed.declines.notify).toBeUndefined();
    expect(rearmed.lastAskAt.notify).toBeUndefined();
    expect(rearmed.satisfied.notify).toBeUndefined();
    expect(shouldPrompt(context({ ledger: rearmed }))).toMatchObject({
      ask: true,
      reason: "first-ask",
    });
  });

  it("keeps the usage history when a prompt is re-armed", () => {
    const ledger = resetPrompt(warmLedger(), "notify");
    expect(ledger.sessions).toBe(4);
    expect(ledger.actions).toBe(1);
  });
});
