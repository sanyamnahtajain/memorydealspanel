/**
 * viewer-context-client — the anonymous short-circuit.
 *
 * The storefront layout stamps `data-viewer-hint="anon"` when the request
 * carried no session cookie. For such a visitor the server answers every
 * slice with its empty value, so the client must not spend a function
 * invocation asking: it settles consumers with the anonymous snapshot
 * locally. Any other (or missing) hint keeps the request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Client = typeof import("./viewer-context-client");

const fetchMock = vi.fn();

async function flush() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

let client: Client;

beforeEach(async () => {
  vi.resetModules();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) } as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
  document.body.innerHTML = "";
  client = await import("./viewer-context-client");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("viewer-context-client anonymous hint", () => {
  it("never calls the API when the page says the visitor has no session", async () => {
    document.body.innerHTML = '<div data-viewer-hint="anon"></div>';
    const seen: unknown[] = [];
    client.subscribe(() => seen.push(client.getViewerContext().access));
    client.needSlice("access" as never);
    client.needPriceLabel("p1");
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    // Consumers still settle: the access snapshot is the anonymous one.
    expect(client.getViewerContext().access).toEqual({ signedIn: false });
    expect(seen.length).toBeGreaterThan(0);
  });

  it("asks as before when the page says a session cookie is present", async () => {
    document.body.innerHTML = '<div data-viewer-hint="session"></div>';
    client.needSlice("access" as never);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks when there is no hint at all — absent never means anonymous", async () => {
    client.needSlice("access" as never);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
