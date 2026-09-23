/*
 * MemoryDeals service worker.
 *
 * Responsibilities:
 *   1. Web Push delivery for BOTH audiences — staff (new orders, access
 *      requests) and buyers (their order status, access reminders, shop news).
 *      Payload is the JSON built by src/server/notify/push.ts:
 *        { title, body, url, type, tag, sound, requireInteraction }
 *   2. Waking the open app so it can play the custom Memory Deals tune (see
 *      the note on sound below).
 *   3. Re-subscribing itself when the browser rotates the push subscription.
 *   4. PWA offline support: precache an app shell + offline fallback page,
 *      network-first for navigations, stale-while-revalidate for same-origin
 *      static assets.
 *
 * Kept dependency-free and defensive. Gated/user-specific data (anything
 * under /api, /admin, /account) is NEVER cached so trade pricing and
 * per-retailer data can't leak across sessions or go stale.
 *
 * ON CUSTOM SOUNDS: a Web Push notification drawn by the operating system
 * uses the OS notification sound — the `sound` property was removed from the
 * Notification API and no browser honours a custom one. So the branded tune
 * can only play on the in-app path: when a push arrives we message every open
 * client, and the page plays the tune itself (src/lib/notify/tune.ts). That
 * covers the case the owner actually cares about — staff with the admin app
 * open — while the OS handles the background case.
 */

const CACHE_VERSION = "v7";
const CACHE_NAME = `memorydeals-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline";

// Artwork (banners, product photos) lives on object storage — a DIFFERENT
// origin from the app. It gets its own cache so the entry cap below can be
// enforced without ever evicting the app shell.
//
// DELIBERATELY NOT VERSIONED. Every other cache is keyed to CACHE_VERSION so
// a deploy discards it, but artwork is immutable and content-addressed (a new
// upload is a new UUID key), so nothing in here can go stale. Versioning it
// would make every deploy re-download every image on every installed phone.
const IMAGE_CACHE_NAME = "memorydeals-img";
// Cap, in entries. Artwork is immutable (every upload gets a fresh UUID key),
// so the cache only ever grows; without a ceiling an installed PWA would
// quietly accumulate every product photo the buyer has ever scrolled past.
const MAX_IMAGE_CACHE_ENTRIES = 80;

// Minimal app shell precached on install. Kept small and static — real pages
// are cached on demand by the fetch handler.
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/favicon.png",
];

// ---------------------------------------------------------------------------
// Push notifications.
// ---------------------------------------------------------------------------

/** Is any window of this app currently visible to the user? */
async function hasVisibleClient() {
  const clientList = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  return clientList.some((client) => client.visibilityState === "visible");
}

/** Tell every open window about the push, so it can ring the branded tune. */
async function broadcastToClients(payload) {
  const clientList = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const client of clientList) {
    try {
      client.postMessage({ source: "memorydeals-push", payload });
    } catch (_err) {
      /* a dead client must not break delivery to the others */
    }
  }
}

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (_err) {
      payload = { body: event.data.text() };
    }
  }

  // Brand fallback, matching APP_NAME in src/lib/constants.ts. A payload
  // should always carry its own title; this is the last resort.
  const title = payload.title || "The Memory Deals";
  const url = payload.url || "/";
  // Staff alerts are addressed to /admin; everything else opens the storefront.
  const isAdminPayload =
    typeof payload.type === "string"
      ? payload.type.startsWith("admin.")
      : url.startsWith("/admin");

  const options = {
    body: payload.body || "You have a new notification.",
    icon: "/icons/icon-192.png",
    badge: "/favicon.png",
    // Same tag => the new card REPLACES the old one instead of stacking, so
    // three updates to one order stay one notification.
    tag: payload.tag || payload.type || "the-memory-deals",
    // …but still alert for the replacement; a silent swap would be missed.
    renotify: Boolean(payload.tag || payload.type),
    requireInteraction: payload.requireInteraction === true,
    // Vibration is the one "sound-like" channel we DO control on Android.
    // The long/urgent tune gets an insistent pattern, the short one a tap.
    vibrate:
      payload.sound === "long"
        ? [300, 120, 300, 120, 300, 120, 500]
        : [200, 100, 200],
    data: {
      url,
      type: payload.type || null,
      sound: payload.sound || "short",
    },
    actions: [{ action: "open", title: isAdminPayload ? "Open" : "View" }],
  };

  event.waitUntil(
    (async () => {
      // Always draw the notification; the OS decides whether to surface it.
      await self.registration.showNotification(title, options);
      // If a window is open, let it play the branded tune.
      if (await hasVisibleClient()) {
        await broadcastToClients(payload);
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const targetUrl = data.url || "/";
  // Staff notifications must land in the admin app, buyer ones in the store —
  // focusing the wrong open window would drop the user somewhere confusing.
  const wantsAdmin = targetUrl.startsWith("/admin");

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          const isAdminClient = client.url.includes("/admin");
          if (isAdminClient === wantsAdmin && "focus" in client) {
            if ("navigate" in client) {
              return client.navigate(targetUrl).then(() => client.focus());
            }
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

/**
 * The browser can rotate a push subscription at any time (key rotation, a
 * long-idle device). Without this handler the device goes silently deaf: the
 * old endpoint stops working and the server never learns the new one.
 *
 * We re-subscribe with the SAME options as the expired subscription (that is
 * where the VAPID application server key lives — a service worker cannot read
 * app env) and hand the new endpoint to the server.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription || null;
      const options =
        (event.newSubscription && event.newSubscription.options) ||
        (old && old.options) || {
          userVisibleOnly: true,
        };

      try {
        const fresh =
          event.newSubscription ||
          (await self.registration.pushManager.subscribe(options));
        if (!fresh) return;

        const json = fresh.toJSON();
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: json.keys,
          }),
        });

        // Retire the dead endpoint so it stops counting as a live device.
        if (old && old.endpoint && old.endpoint !== json.endpoint) {
          await fetch("/api/push/unsubscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ endpoint: old.endpoint }),
          }).catch(() => undefined);
        }
      } catch (_err) {
        // Nothing useful to do here — the next visit re-subscribes from the
        // page, which is the reliable recovery path.
      }
    })(),
  );
});

// Let the page hand control to a waiting worker (used after a version bump).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
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
              (key) =>
                key.startsWith("memorydeals-") &&
                key !== CACHE_NAME &&
                key !== IMAGE_CACHE_NAME,
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

/**
 * Is this a request for artwork on our object storage?
 *
 * Deliberately conservative, because anything matched here is served from
 * cache on a repeat view and so must be CONTENT-ADDRESSED — safe to replay
 * forever. Uploads are keyed by UUID, which satisfies that. The query-string
 * exclusion keeps out both signed URLs (whose response is tied to one
 * request) and the tracking pixels that dress themselves up as images.
 */
function isCacheableRemoteImage(request, url) {
  if (url.protocol !== "https:") return false;
  if (url.search !== "") return false;
  if (request.destination !== "image") return false;
  return /\.(?:png|jpe?g|gif|svg|webp|avif)$/i.test(url.pathname);
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

  // Cross-origin: the ONLY thing worth handling is artwork on object
  // storage. Without this the home banners and every product photo are
  // re-downloaded on each launch, and render as empty boxes on a flaky
  // connection — the failure the installed app is supposed to avoid.
  if (url.origin !== self.location.origin) {
    if (isCacheableRemoteImage(request, url)) {
      event.respondWith(cacheFirstImage(request));
    }
    return;
  }

  // The catalogue image resizer lives under /api but is NOT gated data: every
  // response is a public, immutable, content-addressed picture. It is what
  // the installed app must have offline, so it goes to the artwork cache.
  if (url.pathname === "/api/img" && request.destination === "image") {
    event.respondWith(cacheFirstImage(request));
    return;
  }

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

/**
 * Cache-first for immutable artwork: a hit costs no network at all, which is
 * the whole point on a phone. A miss fetches, stores, and trims.
 *
 * Never throws in a way that changes what the page sees — if both the cache
 * and the network have nothing, the image request simply fails as it would
 * have without a service worker, and the carousel draws its own fallback.
 */
async function cacheFirstImage(request) {
  let cache;
  try {
    cache = await caches.open(IMAGE_CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
  } catch (_err) {
    // Storage unavailable (private mode, quota wedged) — just go to network.
    return fetch(request);
  }

  try {
    const response = await fetchImageForCache(request);
    // `opaque` is what a plain <img> to another origin yields when the host
    // sends no CORS headers: unreadable to us, but still replayable.
    if (response && (response.ok || response.type === "opaque")) {
      await cache.put(request, response.clone());
      trimImageCache(cache);
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request).catch(() => undefined);
    if (cached) return cached;
    throw err;
  }
}

/**
 * Prefer a CORS fetch. An opaque response is padded by several megabytes
 * against the storage quota in some browsers, so a couple of dozen of them
 * can get the whole cache evicted; a readable response is stored at its real
 * size. Falls back to the original request when the host sends no CORS
 * headers, which costs one extra round trip on a cache miss and nothing after.
 */
async function fetchImageForCache(request) {
  try {
    const cors = await fetch(request.url, {
      mode: "cors",
      credentials: "omit",
    });
    if (cors && cors.ok) return cors;
  } catch (_err) {
    /* no CORS headers on that host — fall through */
  }
  return fetch(request);
}

/**
 * Keep the artwork cache bounded, oldest-first. `cache.keys()` returns
 * insertion order, so the head of the list is the least recently ADDED.
 * Fire-and-forget: a failed trim must never fail the image it was trimming for.
 */
function trimImageCache(cache) {
  void (async () => {
    try {
      const keys = await cache.keys();
      const excess = keys.length - MAX_IMAGE_CACHE_ENTRIES;
      if (excess <= 0) return;
      await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
    } catch (_err) {
      /* nothing to do; the next trim tries again */
    }
  })();
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
