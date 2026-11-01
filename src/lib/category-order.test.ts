import { describe, expect, it } from "vitest";
import { completeSiblingOrder, treeOrder } from "./category-order";

const c = (id: string, sortOrder: number, parentId: string | null = null, name = id) => ({ id, name, sortOrder, parentId });

describe("treeOrder", () => {
  it("puts each parent's sub-categories right after it, in their own order", () => {
    const cats = [c("A", 1), c("B", 0), c("a2", 1, "A"), c("a1", 0, "A"), c("b1", 0, "B"), c("C", 2)];
    expect(treeOrder(cats).map((x) => x.id)).toEqual(["B", "b1", "A", "a1", "a2", "C"]);
  });

  it("never interleaves sub-categories with top-level ones that share a number", () => {
    const cats = [c("Root0", 0), c("Root1", 1), c("child0", 0, "Root1")];
    expect(treeOrder(cats).map((x) => x.id)).toEqual(["Root0", "Root1", "child0"]);
  });

  it("keeps a sub-category whose parent is missing, at the end", () => {
    const cats = [c("A", 0), c("lost", 0, "gone")];
    expect(treeOrder(cats).map((x) => x.id)).toEqual(["A", "lost"]);
  });

  it("breaks ties by name", () => {
    expect(treeOrder([c("x", 0, null, "Zeta"), c("y", 0, null, "Alpha")]).map((x) => x.id)).toEqual(["y", "x"]);
  });
});

describe("completeSiblingOrder", () => {
  const sibs = [c("a", 0), c("b", 1), c("c", 2), c("new", 3)];
  it("keeps the requested order and appends siblings the client did not send", () => {
    expect(completeSiblingOrder(["c", "a", "b"], sibs)).toEqual(["c", "a", "b", "new"]);
  });
  it("drops unknown and duplicate ids", () => {
    expect(completeSiblingOrder(["b", "zzz", "b", "a"], sibs)).toEqual(["b", "a", "c", "new"]);
  });
});
