import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Rate limiter facade.
 *
 * When UPSTASH_REDIS_REST_URL (+ token) is configured we use
 * @upstash/ratelimit sliding windows backed by Upstash Redis, so limits are
 * shared across serverless instances. Otherwise (local dev, CI, tests) we
 * fall back to an in-process sliding-window implementation so everything
 * works with zero external services.
 */

export interface LimitOptions {
  /** Maximum number of allowed hits within the window. */
  points: number;
  /** Window length in seconds. */
  window: number;
}

export interface LimitResult {
  ok: boolean;
  remaining: number;
}

export interface Limiter {
  limit(key: string): Promise<LimitResult>;
}

function upstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

// ---------------------------------------------------------------------------
// Upstash-backed implementation
// ---------------------------------------------------------------------------

const globalForRatelimit = globalThis as unknown as {
  __memorydealsRedis: Redis | undefined;
  __memorydealsUpstashLimiters: Map<string, Ratelimit> | undefined;
  __memorydealsMemoryHits: Map<string, number[]> | undefined;
  __memorydealsMemorySweeper: ReturnType<typeof setInterval> | undefined;
};

function getRedis(): Redis {
  if (!globalForRatelimit.__memorydealsRedis) {
    globalForRatelimit.__memorydealsRedis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return globalForRatelimit.__memorydealsRedis;
}

function getUpstashLimiter(opts: LimitOptions, prefix: string): Ratelimit {
  const cache = (globalForRatelimit.__memorydealsUpstashLimiters ??= new Map());
  const cacheKey = `${prefix}:${opts.points}:${opts.window}`;
  let limiter = cache.get(cacheKey);
  if (!limiter) {
    limiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(opts.points, `${opts.window} s`),
      prefix: `rl:${prefix}`,
    });
    cache.set(cacheKey, limiter);
  }
  return limiter;
}

// ---------------------------------------------------------------------------
// In-memory sliding-window fallback (dev / tests / offline)
// ---------------------------------------------------------------------------

const SWEEP_INTERVAL_MS = 60_000;
/** Longest window we ever sweep for; entries older than this are dead. */
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

function getMemoryHits(): Map<string, number[]> {
  if (!globalForRatelimit.__memorydealsMemoryHits) {
    globalForRatelimit.__memorydealsMemoryHits = new Map();
    const sweeper = setInterval(() => {
      const hits = globalForRatelimit.__memorydealsMemoryHits;
      if (!hits) return;
      const cutoff = Date.now() - MAX_WINDOW_MS;
      for (const [key, timestamps] of hits) {
        const alive = timestamps.filter((t) => t > cutoff);
        if (alive.length === 0) {
          hits.delete(key);
        } else if (alive.length !== timestamps.length) {
          hits.set(key, alive);
        }
      }
    }, SWEEP_INTERVAL_MS);
    // Don't keep the process alive just for cleanup.
    sweeper.unref?.();
    globalForRatelimit.__memorydealsMemorySweeper = sweeper;
  }
  return globalForRatelimit.__memorydealsMemoryHits;
}

function memoryLimit(
  key: string,
  opts: LimitOptions,
  prefix: string,
): LimitResult {
  const hits = getMemoryHits();
  const fullKey = `${prefix}:${key}`;
  const now = Date.now();
  const windowStart = now - opts.window * 1000;

  const recent = (hits.get(fullKey) ?? []).filter((t) => t > windowStart);
  if (recent.length >= opts.points) {
    hits.set(fullKey, recent);
    return { ok: false, remaining: 0 };
  }
  recent.push(now);
  hits.set(fullKey, recent);
  return { ok: true, remaining: opts.points - recent.length };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Consume one point for `key` against the given limit. Returns whether the
 * request is allowed and how many points remain in the current window.
 */
export async function limit(
  key: string,
  opts: LimitOptions,
  prefix = "general",
): Promise<LimitResult> {
  if (upstashConfigured()) {
    try {
      const result = await getUpstashLimiter(opts, prefix).limit(key);
      return { ok: result.success, remaining: result.remaining };
    } catch (error) {
      // Redis outage must not take auth/catalog down with it; fail open to
      // the in-memory limiter, which still bounds a single instance.
      console.error("[ratelimit] Upstash error, using in-memory fallback:", error);
      return memoryLimit(key, opts, prefix);
    }
  }
  return memoryLimit(key, opts, prefix);
}

/** Build a reusable limiter with fixed options and key prefix. */
export function createLimiter(opts: LimitOptions, prefix: string): Limiter {
  return {
    limit: (key: string) => limit(key, opts, prefix),
  };
}

/** Login attempts: 5 per minute per key (e.g. phone or IP). */
export const loginLimiter: Limiter = createLimiter(
  { points: 5, window: 60 },
  "login",
);

/** Access requests: 3 per hour per key. */
export const requestAccessLimiter: Limiter = createLimiter(
  { points: 3, window: 3600 },
  "request-access",
);

/** General API traffic: 60 per minute per key. */
export const generalLimiter: Limiter = createLimiter(
  { points: 60, window: 60 },
  "general",
);
