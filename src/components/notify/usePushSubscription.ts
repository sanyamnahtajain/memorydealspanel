"use client";

import * as React from "react";

import type { PermissionState } from "@/lib/notify/engagement";

/**
 * Everything this browser needs to become a push recipient: feature
 * detection, permission, the PushManager subscription, and telling our server
 * about it.
 *
 * One hook serves BOTH surfaces (the buyer's storefront and the admin panel)
 * because the browser-side dance is identical — the server decides which
 * audience a device belongs to from the session that registered it.
 *
 * PLATFORM REALITY, encoded here so the UI can be honest rather than showing
 * a button that silently fails:
 *   - iOS/iPadOS only deliver Web Push to an INSTALLED PWA (16.4+). In a
 *     Safari tab there is no PushManager at all, so we report
 *     "needs-install" instead of "unsupported" — the user can fix it.
 *   - A permission the user has denied cannot be re-requested by script; only
 *     site settings can undo it. We surface that as "denied" so the UI can
 *     explain instead of pointlessly asking again.
 *   - Non-secure origins and in-app browsers (Instagram, some UPI apps —
 *     which is exactly how this shop's customers arrive) have no service
 *     worker. That is a genuine "unsupported".
 */

export type PushStatus =
  | "checking"
  | "unsupported"
  | "needs-install"
  | "unconfigured"
  | "denied"
  | "off"
  | "on";

export interface PushSubscriptionState {
  status: PushStatus;
  /** Raw browser permission, for the re-ask algorithm. */
  permission: PermissionState;
  /** True while a subscribe/unsubscribe round-trip is in flight. */
  busy: boolean;
  /** Last failure, in words a shopkeeper can act on. */
  error: string | null;
  /** True on iOS/iPadOS outside an installed app. */
  iosNeedsInstall: boolean;
  enable: () => Promise<boolean>;
  disable: () => Promise<boolean>;
  refresh: () => void;
}

const SERVICE_WORKER_URL = "/sw.js";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true
  );
}

function isIos(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const isIosDevice = /iphone|ipad|ipod/i.test(ua);
  // iPadOS 13+ reports as a Mac; touch points give it away.
  const isIpadOs = /macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  return isIosDevice || isIpadOs;
}

function supportsPush(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Base64url (VAPID key) -> ArrayBuffer as required by PushManager.subscribe's
 * `applicationServerKey`. Returns a plain ArrayBuffer so the type
 * unambiguously satisfies the DOM lib's BufferSource constraint.
 */
function urlBase64ToBuffer(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return buffer;
}

function readPermission(): PermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  const permission = Notification.permission;
  if (permission === "granted" || permission === "denied") return permission;
  return "default";
}

export function usePushSubscription(): PushSubscriptionState {
  const [status, setStatus] = React.useState<PushStatus>("checking");
  const [permission, setPermission] = React.useState<PermissionState>("default");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const iosNeedsInstall = React.useMemo(
    () => typeof window !== "undefined" && isIos() && !isStandalone(),
    [],
  );

  const refresh = React.useCallback(() => setTick((n) => n + 1), []);

  // Resolve the current state. Runs on mount and after every change.
  React.useEffect(() => {
    let cancelled = false;

    async function resolve() {
      if (!supportsPush()) {
        if (cancelled) return;
        setPermission("unsupported");
        // On iOS the capability appears once the app is installed, so this is
        // a fixable state, not a dead end.
        setStatus(iosNeedsInstall ? "needs-install" : "unsupported");
        return;
      }

      const current = readPermission();
      if (cancelled) return;
      setPermission(current);

      if (!vapidKey) {
        setStatus("unconfigured");
        return;
      }
      if (current === "denied") {
        setStatus("denied");
        return;
      }

      try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (cancelled) return;
        setStatus(existing && current === "granted" ? "on" : "off");
      } catch {
        if (!cancelled) setStatus("off");
      }
    }

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [iosNeedsInstall, vapidKey, tick]);

  const enable = React.useCallback(async (): Promise<boolean> => {
    setError(null);

    if (!supportsPush()) {
      setError(
        iosNeedsInstall
          ? "On iPhone, add the app to your home screen first. Then you can turn on alerts."
          : "This browser cannot show alerts. Try Chrome or Safari.",
      );
      return false;
    }
    if (!vapidKey) {
      setError("Alerts are not set up on the server yet.");
      return false;
    }

    setBusy(true);
    try {
      // Must be called from the user's click for the prompt to appear.
      const result = await Notification.requestPermission();
      setPermission(result === "granted" ? "granted" : result === "denied" ? "denied" : "default");

      if (result !== "granted") {
        setStatus(result === "denied" ? "denied" : "off");
        return false;
      }

      const registration =
        (await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL)) ??
        (await navigator.serviceWorker.register(SERVICE_WORKER_URL));
      await navigator.serviceWorker.ready;

      // Re-use an existing subscription when there is one: subscribing twice
      // with a different key throws, and the endpoint is the stable identity
      // the server upserts on anyway.
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBuffer(vapidKey),
        }));

      const json = subscription.toJSON();
      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          userAgent: navigator.userAgent,
        }),
      });

      if (!response.ok) {
        // Leaving a browser subscription the server does not know about would
        // show "on" while nothing arrives — worse than a clean failure.
        await subscription.unsubscribe().catch(() => undefined);
        setError(
          response.status === 401
            ? "Please sign in first, then turn on alerts."
            : "Could not turn on alerts. Please try again.",
        );
        setStatus("off");
        return false;
      }

      setStatus("on");
      return true;
    } catch (cause) {
      console.error("[push] enable failed:", cause);
      setError("Could not turn on alerts. Please try again.");
      setStatus("off");
      return false;
    } finally {
      setBusy(false);
    }
  }, [iosNeedsInstall, vapidKey]);

  const disable = React.useCallback(async (): Promise<boolean> => {
    setError(null);
    if (!supportsPush()) return false;

    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        // Tell the server FIRST: if the network fails we keep the local
        // subscription, so the user is not left silently unsubscribed on the
        // device while the server still believes it can reach them.
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => undefined);
        await subscription.unsubscribe();
      }
      setStatus("off");
      return true;
    } catch (cause) {
      console.error("[push] disable failed:", cause);
      setError("Could not turn off alerts. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    status,
    permission,
    busy,
    error,
    iosNeedsInstall,
    enable,
    disable,
    refresh,
  };
}
