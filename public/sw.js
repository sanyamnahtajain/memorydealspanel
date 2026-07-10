/*
 * MemoryDeals admin push service worker.
 *
 * Handles Web Push delivery for admin notifications (new access requests,
 * expiring grants, etc.). The payload is the JSON produced by
 * `sendPushToAdmin` in src/server/notify/push.ts:
 *   { title: string, body: string, url: string }
 *
 * Kept dependency-free and defensive: a malformed or bodyless push still
 * surfaces a generic notification rather than throwing.
 */

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
    icon: "/next.svg",
    badge: "/next.svg",
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
