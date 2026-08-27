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

/**
 * What /api/access-status actually returns: the shared access snapshot plus
 * client-surface extras. Kept here (not in lib/access-status) because only
 * these client consumers care — `resolveAccessState` ignores the extras.
 */
export interface AccessStatusSnapshot extends AccessSnapshot {
  /**
   * Non-cancelled orders this customer has placed. Optional for backward
   * compatibility with older cached payloads — absent means 0. NOT monetary.
   */
  orderCount?: number;
}

import {
  getViewerContext,
  needSlice,
  refreshViewerContext,
  subscribe,
} from "@/components/storefront/viewer-context-client";
import { CONTEXT_SLICES } from "@/lib/viewer-context";

export interface UseAccessStatusReturn {
  /** `null` until the (shared) fetch resolves — render nothing meanwhile. */
  snapshot: AccessStatusSnapshot | null;
  /** Drop the cache and refetch; every mounted consumer updates. */
  refresh: () => void;
}

/**
 * NOTE: this no longer owns a fetch. It registers the `access` slice with the
 * shared per-viewer request (viewer-context-client) which batches it together
 * with whatever else the page needs into ONE network call. The return shape is
 * unchanged, so every existing consumer works untouched.
 */
export function useAccessStatus(): UseAccessStatusReturn {
  const [snapshot, setSnapshot] = React.useState<AccessStatusSnapshot | null>(
    () => getViewerContext().access,
  );

  React.useEffect(() => {
    const update = () => setSnapshot(getViewerContext().access);
    const unsubscribe = subscribe(update);
    needSlice(CONTEXT_SLICES.access);
    update();
    return unsubscribe;
  }, []);

  const refresh = React.useCallback(() => {
    refreshViewerContext();
  }, []);

  return { snapshot, refresh };
}
