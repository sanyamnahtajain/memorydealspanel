"use client";

import * as React from "react";
import { toast } from "sonner";
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

/**
 * PushToggle — an admin control that opts this browser in/out of Web Push
 * notifications (new access requests, expiries, etc.).
 *
 * Flow:
 *  1. Feature-detect ServiceWorker + PushManager + Notification. When any is
 *     missing (older Safari, insecure origin, in-app browsers) we render a
 *     disabled, explanatory state rather than a broken button.
 *  2. On enable: request Notification permission, register the service worker,
 *     subscribe via PushManager using the VAPID public key, and POST the
 *     serialized subscription to /api/push/subscribe.
 *  3. On disable: unsubscribe locally and POST the endpoint to
 *     /api/push/unsubscribe so the server prunes it too.
 *
 * The VAPID public key comes from NEXT_PUBLIC_VAPID_PUBLIC_KEY. When it is
 * unset the control degrades to a disabled "not configured" state.
 *
 * INTEGRATOR NOTE: this expects a service worker served at /sw.js that handles
 * `push` and `notificationclick` events. If your app registers its SW
 * elsewhere, set `serviceWorkerUrl` to match.
 */

type PushState =
  | "loading"
  | "unsupported"
  | "unconfigured"
  | "denied"
  | "idle" // supported, permission grantable, not subscribed
  | "subscribed"
  | "busy";

interface PushToggleProps {
  /** URL of the push service worker. Defaults to "/sw.js". */
  serviceWorkerUrl?: string;
  className?: string;
  /** Compact icon-only rendering (e.g. in a topbar) vs. a labelled button. */
  compact?: boolean;
}

/**
 * Base64url (VAPID key) -> ArrayBuffer as required by
 * PushManager.subscribe's `applicationServerKey`. We return an ArrayBuffer
 * (rather than a Uint8Array view) so the type is unambiguously backed by a
 * plain ArrayBuffer, satisfying the DOM lib's BufferSource constraint.
 */
function urlBase64ToBuffer(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) {
    view[i] = raw.charCodeAt(i);
  }
  return buffer;
}

function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function serializeExisting(
  registration: ServiceWorkerRegistration,
): Promise<PushSubscription | null> {
  return registration.pushManager.getSubscription();
}

export function PushToggle({
  serviceWorkerUrl = "/sw.js",
  className,
  compact = false,
}: PushToggleProps) {
  const [state, setState] = React.useState<PushState>("loading");
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  // Initial feature-detect + existing-subscription check.
  React.useEffect(() => {
    let cancelled = false;

    async function detect() {
      if (!isPushSupported()) {
        if (!cancelled) setState("unsupported");
        return;
      }
      if (!vapidKey) {
        if (!cancelled) setState("unconfigured");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setState("denied");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.getRegistration(
          serviceWorkerUrl,
        );
        const existing = registration
          ? await serializeExisting(registration)
          : null;
        if (!cancelled) setState(existing ? "subscribed" : "idle");
      } catch {
        if (!cancelled) setState("idle");
      }
    }

    void detect();
    return () => {
      cancelled = true;
    };
  }, [serviceWorkerUrl, vapidKey]);

  const enable = React.useCallback(async () => {
    if (!vapidKey) return;
    setState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "idle");
        toast.error("Notifications were not allowed.");
        return;
      }

      const registration =
        (await navigator.serviceWorker.getRegistration(serviceWorkerUrl)) ??
        (await navigator.serviceWorker.register(serviceWorkerUrl));
      await navigator.serviceWorker.ready;

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
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          userAgent:
            typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        }),
      });

      if (!response.ok) {
        // Roll the local subscription back so client and server agree.
        await subscription.unsubscribe().catch(() => undefined);
        throw new Error(`subscribe endpoint returned ${response.status}`);
      }

      setState("subscribed");
      toast.success("Notifications enabled on this device.");
    } catch (error) {
      console.error("[PushToggle] enable failed:", error);
      setState("idle");
      toast.error("Could not enable notifications.");
    }
  }, [serviceWorkerUrl, vapidKey]);

  const disable = React.useCallback(async () => {
    setState("busy");
    try {
      const registration = await navigator.serviceWorker.getRegistration(
        serviceWorkerUrl,
      );
      const subscription = registration
        ? await registration.pushManager.getSubscription()
        : null;

      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe().catch(() => undefined);
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        }).catch(() => undefined);
      }

      setState("idle");
      toast.success("Notifications disabled on this device.");
    } catch (error) {
      console.error("[PushToggle] disable failed:", error);
      setState("subscribed");
      toast.error("Could not disable notifications.");
    }
  }, [serviceWorkerUrl]);

  // --- Non-actionable states -------------------------------------------
  if (state === "loading") {
    return (
      <Button
        type="button"
        variant="outline"
        size={compact ? "icon" : "sm"}
        disabled
        aria-label="Checking notification support"
        className={className}
      >
        <Loader2 className="animate-spin" aria-hidden />
        {compact ? null : <span>Notifications</span>}
      </Button>
    );
  }

  if (state === "unsupported" || state === "unconfigured" || state === "denied") {
    const hint =
      state === "unsupported"
        ? "Push notifications aren't supported in this browser."
        : state === "unconfigured"
          ? "Push notifications aren't configured on the server."
          : "Notifications are blocked. Enable them in your browser settings.";
    return (
      <Tooltip content={hint}>
        <Button
          type="button"
          variant="outline"
          size={compact ? "icon" : "sm"}
          disabled
          aria-label={hint}
          className={cn("text-muted-foreground", className)}
        >
          <BellOff aria-hidden />
          {compact ? null : <span>Unavailable</span>}
        </Button>
      </Tooltip>
    );
  }

  // --- Actionable states ------------------------------------------------
  const busy = state === "busy";
  const subscribed = state === "subscribed";

  return (
    <Tooltip
      content={
        subscribed
          ? "Notifications are on for this device"
          : "Enable notifications for this device"
      }
    >
      <Button
        type="button"
        variant={subscribed ? "secondary" : "outline"}
        size={compact ? "icon" : "sm"}
        disabled={busy}
        onClick={subscribed ? disable : enable}
        aria-pressed={subscribed}
        aria-label={
          subscribed
            ? "Disable notifications on this device"
            : "Enable notifications on this device"
        }
        className={className}
      >
        {busy ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : subscribed ? (
          <BellRing aria-hidden />
        ) : (
          <Bell aria-hidden />
        )}
        {compact ? null : (
          <span>{subscribed ? "Notifications on" : "Enable notifications"}</span>
        )}
      </Button>
    </Tooltip>
  );
}
