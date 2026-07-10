/**
 * localStorage-backed persistence for saved views. Runs in the jsdom project
 * (`.test.tsx`) because the node project has no `localStorage`.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  createEmptyView,
  deleteView,
  loadViews,
  saveViews,
  upsertView,
} from "./savedViews";

describe("persistence (localStorage)", () => {
  beforeEach(() => {
    globalThis.localStorage?.clear?.();
  });

  it("saves and loads views keyed by gridId", () => {
    const views = [createEmptyView("v1", "One")];
    saveViews("grid-a", views);
    expect(loadViews("grid-a")).toEqual(views);
    expect(loadViews("grid-b")).toEqual([]);
  });

  it("upserts by id", () => {
    upsertView("g", createEmptyView("v1", "One"));
    const updated = { ...createEmptyView("v1", "Renamed"), hidden: ["x"] };
    const all = upsertView("g", updated);
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("Renamed");
    expect(all[0].hidden).toEqual(["x"]);
  });

  it("deletes by id", () => {
    upsertView("g", createEmptyView("v1", "One"));
    upsertView("g", createEmptyView("v2", "Two"));
    const rest = deleteView("g", "v1");
    expect(rest.map((v) => v.id)).toEqual(["v2"]);
  });
});
