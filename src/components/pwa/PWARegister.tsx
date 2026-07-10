"use client";

import { useEffect } from "react";

/**
 * Registers the MemoryDeals service worker (`/sw.js`) once the page has
 * loaded. Renders nothing.
 *
 * Mounted once in the root layout via the `PWA_REGISTER_SLOT`. Safe to render
 * anywhere and on any surface: it no-ops gracefully when the browser lacks
 * service-worker support (older browsers, some in-app webviews) and only
 * registers in a secure context (https / localhost) as the API requires.
 */
export function PWARegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    const register = () => {
      if (cancelled) return;
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration can fail on unsupported/insecure contexts — degrade
        // silently, the app remains fully functional online.
      });
    };

    // Defer until after load so SW install doesn't contend with first paint.
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}

export default PWARegister;
