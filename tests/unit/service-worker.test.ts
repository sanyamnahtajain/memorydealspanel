import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The service worker's fetch routing.
 *
 * This file is the installed PWA's whole offline story, and it is invisible
 * until it breaks someone's app — there is no dev-server path that exercises
 * it. So it is loaded as source and driven directly, with a fake Cache API.
 *
 * The behaviour that matters most here is the CROSS-ORIGIN IMAGE branch:
 * banners and product photos live on object storage, a different origin from
 * the app, and a service worker that bails on cross-origin requests (as this
 * one used to) re-downloads every one of them on every launch and renders
 * empty boxes the moment the connection is flaky.
 */

const SOURCE = readFileSync(
  new URL("../../public/sw.js", import.meta.url),
  "utf8",
);

const APP_ORIGIN = "https://www.thememorydeals.com";
const CDN = "https://pub-abc123.r2.dev";

interface SWRequest {
  url: string;
  method: string;
  destination: string;
  mode: string;
}

function imageRequest(url: string): SWRequest {
  return { url, method: "GET", destination: "image", mode: "no-cors" };
}

/** A Cache that keys on request URL — enough for everything the worker does. */
class FakeCache {
  entries = new Map<string, unknown>();
  async match(req: SWRequest | string) {
    return this.entries.get(typeof req === "string" ? req : req.url);
  }
  async put(req: SWRequest | string, res: unknown) {
    this.entries.set(typeof req === "string" ? req : req.url, res);
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
  async delete(req: { url: string } | string) {
    return this.entries.delete(typeof req === "string" ? req : req.url);
  }
}

/** The minimum of a Response the worker inspects: ok, type, clone(). */
function fakeResponse(init: { ok?: boolean; type?: string; body?: string }) {
  const res = {
    ok: init.ok ?? true,
    type: init.type ?? "basic",
    body: init.body ?? "",
    clone() {
      return res;
    },
  };
  return res;
}

interface Harness {
  listeners: Record<string, (event: unknown) => void>;
  cacheStore: Map<string, FakeCache>;
  fetchMock: ReturnType<typeof vi.fn>;
  fire: (request: SWRequest) => Promise<unknown> | undefined;
  imageCache: () => FakeCache | undefined;
}

function load(
  fetchImpl: (input: unknown, init?: unknown) => Promise<unknown>,
): Harness {
  const listeners: Record<string, (event: unknown) => void> = {};
  const cacheStore = new Map<string, FakeCache>();

  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners[type] = fn;
    },
    location: { origin: APP_ORIGIN },
    clients: { matchAll: async () => [], claim: async () => {} },
    registration: { showNotification: async () => {} },
    skipWaiting: () => {},
  };

  const caches = {
    open: async (name: string) => {
      let cache = cacheStore.get(name);
      if (!cache) {
        cache = new FakeCache();
        cacheStore.set(name, cache);
      }
      return cache;
    },
    keys: async () => [...cacheStore.keys()],
    delete: async (name: string) => cacheStore.delete(name),
  };

  const fetchMock = vi.fn(fetchImpl);

  // Evaluated, not imported: the file is a classic worker script with no
  // exports, and each test needs its own fresh copy of its module state.
  const run = new Function("self", "caches", "fetch", "Response", SOURCE);
  run(self, caches, fetchMock, Response);

  function fire(request: SWRequest) {
    let responded: Promise<unknown> | undefined;
    listeners.fetch?.({
      request,
      respondWith: (value: Promise<unknown>) => {
        responded = value;
      },
      waitUntil: () => {},
    });
    return responded;
  }

  const imageCache = () =>
    [...cacheStore.entries()].find(([name]) =>
      name === "memorydeals-img",
    )?.[1];

  return { listeners, cacheStore, fetchMock, fire, imageCache };
}

/** Resolve every pending microtask, including the fire-and-forget trim. */
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("service worker — artwork on object storage", () => {
  let ok: Harness;

  beforeEach(() => {
    ok = load(async () => fakeResponse({ ok: true, body: "bytes" }));
  });

  it("serves a repeat request for the same artwork without touching the network", async () => {
    const request = imageRequest(`${CDN}/banners/diwali.jpg`);

    await ok.fire(request);
    await settle();
    expect(ok.fetchMock).toHaveBeenCalledTimes(1);

    await ok.fire(imageRequest(`${CDN}/banners/diwali.jpg`));
    await settle();
    // Cache hit: the second launch costs nothing at all.
    expect(ok.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps artwork in its own UNVERSIONED cache, apart from the app shell", async () => {
    await ok.fire(imageRequest(`${CDN}/banners/diwali.jpg`));
    await settle();
    const names = [...ok.cacheStore.keys()];
    // Unversioned on purpose: artwork is content-addressed and cannot go
    // stale, so a deploy must not make every phone re-download all of it.
    expect(names).toContain("memorydeals-img");
    expect(names.some((n) => /^memorydeals-img-v\d/.test(n))).toBe(false);
    // A full artwork cache must never be able to evict the offline page:
    // the shell lives in its own, separately named cache.
    await ok.fire({
      url: `${APP_ORIGIN}/c/chargers`,
      method: "GET",
      destination: "document",
      mode: "navigate",
    });
    await settle();
    expect(
      [...ok.cacheStore.keys()].filter((n) => n !== "memorydeals-img"),
    ).toHaveLength(1);
    expect(ok.imageCache()?.entries.size).toBe(1);
  });

  it("prefers a CORS fetch, so the entry is not padded against the quota", async () => {
    await ok.fire(imageRequest(`${CDN}/banners/diwali.jpg`));
    await settle();
    expect(ok.fetchMock).toHaveBeenCalledWith(
      `${CDN}/banners/diwali.jpg`,
      expect.objectContaining({ mode: "cors", credentials: "omit" }),
    );
  });

  it("still caches an opaque response when the host sends no CORS headers", async () => {
    const harness = load(async (input: unknown) => {
      // The CORS attempt is rejected; the plain request yields an opaque body.
      if (typeof input === "string") throw new TypeError("CORS blocked");
      return fakeResponse({ ok: false, type: "opaque" });
    });

    await harness.fire(imageRequest(`${CDN}/banners/diwali.jpg`));
    await settle();
    expect(harness.imageCache()?.entries.size).toBe(1);
  });

  it("replays cached artwork when the network is gone", async () => {
    await ok.fire(imageRequest(`${CDN}/banners/diwali.jpg`));
    await settle();

    const offline = load(async () => {
      throw new TypeError("Failed to fetch");
    });
    // Re-point the offline worker at the cache the first one filled.
    offline.cacheStore.clear();
    for (const [name, cache] of ok.cacheStore) offline.cacheStore.set(name, cache);

    const response = await offline.fire(imageRequest(`${CDN}/banners/diwali.jpg`));
    expect(response).toBeDefined();
  });

  it("caps the cache so a long-scrolling buyer cannot fill the phone", async () => {
    for (let i = 0; i < 95; i++) {
      await ok.fire(imageRequest(`${CDN}/products/p${i}.jpg`));
      await settle();
    }
    const size = ok.imageCache()?.entries.size ?? 0;
    expect(size).toBeLessThanOrEqual(80);
    expect(size).toBeGreaterThan(0);
  });

  it("evicts the oldest artwork first", async () => {
    for (let i = 0; i < 95; i++) {
      await ok.fire(imageRequest(`${CDN}/products/p${i}.jpg`));
      await settle();
    }
    const cache = ok.imageCache()!;
    expect(cache.entries.has(`${CDN}/products/p0.jpg`)).toBe(false);
    expect(cache.entries.has(`${CDN}/products/p94.jpg`)).toBe(true);
  });
});

describe("service worker — what it deliberately leaves alone", () => {
  let ok: Harness;

  beforeEach(() => {
    ok = load(async () => fakeResponse({ ok: true }));
  });

  it("ignores a cross-origin URL carrying a query string", () => {
    // Signed URLs are tied to one request, and tracking pixels dress
    // themselves up as images. Neither is safe to replay from cache.
    expect(
      ok.fire(imageRequest(`${CDN}/banners/x.jpg?X-Amz-Signature=abc`)),
    ).toBeUndefined();
    expect(
      ok.fire(imageRequest("https://analytics.example.test/px.gif?id=42")),
    ).toBeUndefined();
  });

  it("ignores cross-origin requests that are not images", () => {
    expect(
      ok.fire({
        url: "https://api.example.test/track",
        method: "GET",
        destination: "",
        mode: "cors",
      }),
    ).toBeUndefined();
  });

  it("ignores anything that is not a GET", () => {
    expect(
      ok.fire({
        url: `${CDN}/banners/diwali.jpg`,
        method: "POST",
        destination: "image",
        mode: "no-cors",
      }),
    ).toBeUndefined();
  });

  it("caches the catalogue resizer's output even though it lives under /api", async () => {
    // /api/img is public, immutable artwork — the pictures an installed app
    // must still have offline. It is the one /api path the worker handles.
    const response = await ok.fire({
      url: `${APP_ORIGIN}/api/img?u=https%3A%2F%2Fpub-x.r2.dev%2Fp%2F1.png&w=640&q=75`,
      method: "GET",
      destination: "image",
      mode: "no-cors",
    });
    expect(response).toBeDefined();
    await settle();
    expect(ok.imageCache()?.entries.size).toBe(1);
  });

  it("never caches gated same-origin data", () => {
    for (const path of ["/api/me/context", "/admin/products", "/account"]) {
      expect(
        ok.fire({
          url: `${APP_ORIGIN}${path}`,
          method: "GET",
          destination: "document",
          mode: "navigate",
        }),
      ).toBeUndefined();
    }
  });

  it("still handles same-origin navigations and static assets", () => {
    expect(
      ok.fire({
        url: `${APP_ORIGIN}/c/chargers`,
        method: "GET",
        destination: "document",
        mode: "navigate",
      }),
    ).toBeDefined();
    expect(
      ok.fire({
        url: `${APP_ORIGIN}/_next/static/chunks/main.js`,
        method: "GET",
        destination: "script",
        mode: "no-cors",
      }),
    ).toBeDefined();
  });
});
