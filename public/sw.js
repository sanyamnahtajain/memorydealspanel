/*
 * MemoryDeals service worker.
 *
 * Responsibilities:
 *   1. Web Push delivery for admin notifications (new access requests,
 *      expiring grants, etc.). Payload is the JSON from `sendPushToAdmin`
 *      in src/server/notify/push.ts: { title, body, url }.
 *   2. PWA offline support: precache an app shell + offline fallback page,
 *      network-first for navigations, stale-while-revalidate for same-origin
 *      static assets.
 *
 * Kept dependency-free and defensive. Gated/user-specific data (anything
 * under /api, /admin, /account) is NEVER cached so trade pricing and
 * per-retailer data can't leak across sessions or go stale.
 */

const CACHE_VERSION = "v1";
const CACHE_NAME = `memorydeals-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline";

// Minimal app shell precached on install. Kept small and static — real pages
// are cached on demand by the fetch handler.
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-maskable.svg",
  "/icons/favicon.svg",
  "/icons/apple-touch-icon.svg",
];

// ---------------------------------------------------------------------------
// Push notifications (admin) — behaviour preserved.
// ---------------------------------------------------------------------------

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (_err) {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || "MemoryDeals";
  const options = {
    body: payload.body || "You have a new notification.",
    icon: "/icons/icon.svg",
    badge: "/icons/favicon.svg",
    tag: payload.tag || "memorydeals-admin",
    data: { url: payload.url || "/admin/dashboard" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data && event.notification.data.url) ||
    "/admin/dashboard";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing admin tab if one is already open.
        for (const client of clientList) {
          if (client.url.includes("/admin") && "focus" in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      }),
  );
});

// ---------------------------------------------------------------------------
// Install / activate — precache shell, take control, clean old caches.
// ---------------------------------------------------------------------------

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith("memorydeals-") && key !== CACHE_NAME,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// ---------------------------------------------------------------------------
// Fetch — routing strategy.
// ---------------------------------------------------------------------------

// Never cache gated / user-specific / mutating data.
function isNonCacheablePath(pathname) {
  return (
    pathname.startsWith("/api") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/account")
  );
}

// Same-origin static assets we can safely serve stale-while-revalidate.
function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/_next/static") ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/seed/") ||
    /\.(?:css|js|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|avif|ico)$/i.test(
      pathname,
    )
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET; let the network deal with everything else (POST/PUT/etc).
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch (_err) {
    return;
  }

  // Only intercept same-origin requests.
  if (url.origin !== self.location.origin) return;

  // Never touch gated data — always straight to network.
  if (isNonCacheablePath(url.pathname)) return;

  // Navigations: network-first, fall back to cached page then offline shell.
  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  // Static assets: stale-while-revalidate.
  if (isStaticAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    // Cache successful navigations so repeat visits work offline.
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_err) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response("You are offline.", {
      status: 503,
      statusText: "Service Unavailable",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  return cached || (await network) || fetch(request);
}
