/**
 * viewer-context-client — the ONE batched per-viewer request.
 *
 * The contract this suite pins down:
 *   1. every `needPriceLabel` registered in one commit lands in ONE fetch,
 *      with the priceLabels slice named in `want`;
 *   2. an id registered AFTER that batch has completed (a rail that streams
 *      in through a Suspense boundary — the "Best sellers priced, Trending
 *      locked" bug) schedules a SECOND fetch for the new ids ONLY, and that
 *      fetch names the priceLabels slice again — without it the route
 *      ignores the ids and the late cards stay locked forever;
 *   3. an already-fetched id is never asked for twice;
 *   4. labels MERGE across fetches — a later batch never blanks an earlier one.
 *
 * PRICE GATE: nothing here decides entitlement. The fetch is mocked; the
 * labels it returns are opaque strings, exactly as the route hands them out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Client = typeof import("./viewer-context-client");

const fetchMock = vi.fn();

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  } as unknown as Response;
}

/** Parses the one query string a fetch call was made with. */
function requestParams(call: number): URLSearchParams {
  const url = fetchMock.mock.calls[call]?.[0] as string;
  return new URL(url, "http://test.local").searchParams;
}

/** Microtask-deferred batching: flush pending microtasks + the awaited fetch. */
async function flush() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

let client: Client;

beforeEach(async () => {
  // Module state (fetched sets, payload) is module-local — a fresh module per
  // test is the only way to start from "nothing fetched".
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  client = await import("./viewer-context-client");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("viewer-context-client price-label batching", () => {
  it("batches every id registered in one commit into ONE request naming priceLabels", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ priceLabels: { a: "₹1", b: "₹2" } }),
    );

    client.needPriceLabel("a");
    client.needPriceLabel("b");
    client.needPriceLabel("a"); // duplicate within the same commit
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const params = requestParams(0);
    expect(params.get("want")).toBe("priceLabels");
    expect(params.get("ids")?.split(",").sort()).toEqual(["a", "b"]);
    expect(client.getViewerContext().priceLabels).toEqual({ a: "₹1", b: "₹2" });
  });

  it("a late id (after the batch completed) schedules a SECOND fetch that names priceLabels again", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ priceLabels: { a: "₹1" } }))
      .mockResolvedValueOnce(jsonResponse({ priceLabels: { late: "₹9" } }));

    client.needPriceLabel("a");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A Suspense boundary resolves and a new rail's slots mount.
    const listener = vi.fn();
    client.subscribe(listener);
    client.needPriceLabel("late");
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = requestParams(1);
    // THE BUG: this used to be absent, so the route returned {} for the ids.
    expect(second.get("want")).toBe("priceLabels");
    // Only the new id travels — never the ones already fetched.
    expect(second.get("ids")).toBe("late");
    // Merged, not replaced.
    expect(client.getViewerContext().priceLabels).toEqual({ a: "₹1", late: "₹9" });
    expect(listener).toHaveBeenCalled();
  });

  it("never refetches an id that has already been fetched", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ priceLabels: { a: "₹1" } }));

    client.needPriceLabel("a");
    await flush();
    client.needPriceLabel("a");
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a late id alongside a late slice names both in one request", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ priceLabels: { a: "₹1" } }))
      .mockResolvedValueOnce(
        jsonResponse({ access: { signedIn: true }, priceLabels: { b: "₹2" } }),
      );

    client.needPriceLabel("a");
    await flush();

    client.needSlice("access");
    client.needPriceLabel("b");
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = requestParams(1);
    expect(second.get("want")?.split(",").sort()).toEqual(["access", "priceLabels"]);
    expect(second.get("ids")).toBe("b");
  });

  it("forgets a failed batch so a later mount can retry it", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(jsonResponse({ priceLabels: { a: "₹1" } }));

    client.needPriceLabel("a");
    await flush();
    expect(client.getViewerContext().priceLabels).toEqual({});

    client.needPriceLabel("a");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.getViewerContext().priceLabels).toEqual({ a: "₹1" });
  });
});
