"use client";

import * as React from "react";

import type { AccessSnapshot } from "@/lib/access-status";

/**
 * Client-side access to the viewer's access snapshot for components that are
 * mounted from many places (shell banner, price gates, renewal surfaces)
 * where prop-drilling the server-resolved viewer would touch every call site.
 *
 * One fetch per page load (module-level promise cache, shared by every
 * consumer). Until it resolves — or if it fails — the snapshot is `null`, so
 * consumers render nothing and a network error can never break a flow.
 * `refresh()` clears the cache and refetches (call it after a renewal request
 * succeeds so every mounted consumer repaints from the new truth).
 */

let cached: AccessSnapshot | null = null;
let inflight: Promise<AccessSnapshot | null> | null = null;

/** Mounted consumers, notified whenever the cached snapshot changes. */
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function load(): Promise<AccessSnapshot | null> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetch("/api/access-status")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { snapshot?: AccessSnapshot } | null) => {
        const snapshot = json?.snapshot;
        if (!snapshot || typeof snapshot.signedIn !== "boolean") {
          inflight = null; // allow a retry on the next mount
          return null;
        }
        cached = snapshot;
        notify();
        return cached;
      })
      .catch(() => {
        inflight = null; // allow a retry on the next mount
        return null;
      });
  }
  return inflight;
}

export interface UseAccessStatusReturn {
  /** `null` until the (shared) fetch resolves — render nothing meanwhile. */
  snapshot: AccessSnapshot | null;
  /** Drop the cache and refetch; every mounted consumer updates. */
  refresh: () => void;
}

export function useAccessStatus(): UseAccessStatusReturn {
  const [snapshot, setSnapshot] = React.useState<AccessSnapshot | null>(cached);

  React.useEffect(() => {
    const update = () => setSnapshot(cached);
    listeners.add(update);
    void load().then(() => update());
    return () => {
      listeners.delete(update);
    };
  }, []);

  const refresh = React.useCallback(() => {
    cached = null;
    inflight = null;
    void load();
  }, []);

  return { snapshot, refresh };
}
