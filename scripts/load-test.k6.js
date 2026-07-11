/*
 * Load-sanity test for The Memory Deals storefront (Phase 9).
 *
 * Exercises the public, ISR-cached storefront paths (home, category, product,
 * search) under concurrent anonymous load — the scalable read path that serves
 * the bulk of traffic. Also doubles as a SECURITY-UNDER-LOAD check: it asserts
 * that no price ever appears in an anonymous response, even at high concurrency.
 *
 * Usage:
 *   BASE_URL=https://thememorydeals.com k6 run scripts/load-test.k6.js
 *   (local:  BASE_URL=http://localhost:3000 npm run dev  # in another shell, then run)
 *
 * Requires k6 (https://k6.io). Not part of the app bundle.
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const priceLeaks = new Rate("anon_price_leaks");

const BASE = __ENV.BASE_URL || "http://localhost:3000";

// A handful of seeded slugs; override via env for a real catalog.
const CATEGORY = __ENV.CATEGORY_SLUG || "power-cables";
const PRODUCT = __ENV.PRODUCT_SLUG || "callmate-3-in-1-charging-cable";
const QUERY = __ENV.SEARCH_Q || "charger";

export const options = {
  scenarios: {
    browse: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 }, // ramp to 50 concurrent shoppers
        { duration: "1m", target: 50 }, // hold
        { duration: "30s", target: 100 }, // spike
        { duration: "1m", target: 100 },
        { duration: "30s", target: 0 }, // ramp down
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<1500"], // 95% of pages under 1.5s
    http_req_failed: ["rate<0.01"], // <1% errors
    anon_price_leaks: ["rate==0"], // ZERO price leaks — non-negotiable
  },
};

// ₹ amounts / paise-ish digit runs that must never appear for an anon viewer.
// (Product/category/search/home carry NO price in any anon payload.)
const PRICE_MARKERS = [/₹\s?\d/, /"price"\s*:\s*\d/, /"mrp"\s*:\s*\d/];

function assertNoPrice(res, name) {
  const body = res.body || "";
  const leaked = PRICE_MARKERS.some((re) => re.test(body));
  priceLeaks.add(leaked);
  check(res, {
    [`${name} 200`]: (r) => r.status === 200,
    [`${name} no price for anon`]: () => !leaked,
  });
}

export default function () {
  assertNoPrice(http.get(`${BASE}/`), "home");
  sleep(0.5);
  assertNoPrice(http.get(`${BASE}/categories`), "categories");
  sleep(0.5);
  assertNoPrice(http.get(`${BASE}/c/${CATEGORY}`), "category");
  sleep(0.5);
  assertNoPrice(http.get(`${BASE}/p/${PRODUCT}`), "product");
  sleep(0.5);
  assertNoPrice(
    http.get(`${BASE}/search?q=${encodeURIComponent(QUERY)}`),
    "search",
  );
  sleep(1);
}
