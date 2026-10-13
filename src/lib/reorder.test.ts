import { describe, expect, it } from "vitest";
import { mergeVisibleOrder, moveItem, moveItemByKey, resolveDropOrder } from "./reorder";

describe("moveItem", () => {
  it("moves one position to the right", () => {
    expect(moveItem(["a", "b", "c", "d"], 1, 2)).toEqual(["a", "c", "b", "d"]);
  });

  it("moves one position to the left", () => {
    expect(moveItem(["a", "c", "b", "d"], 2, 1)).toEqual(["a", "b", "c", "d"]);
  });

  it("round-trips right then left back to the start", () => {
    const start = ["a", "b", "c", "d"];
    const afterRight = moveItem(start, 1, 2);
    expect(afterRight).toEqual(["a", "c", "b", "d"]);
    expect(moveItem(afterRight, 2, 1)).toEqual(start);
  });

  it("round-trips left then right back to the start", () => {
    const start = ["a", "b", "c", "d"];
    const afterLeft = moveItem(start, 2, 1);
    expect(afterLeft).toEqual(["a", "c", "b", "d"]);
    expect(moveItem(afterLeft, 1, 2)).toEqual(start);
  });

  it("moves to the first and last positions", () => {
    expect(moveItem(["a", "b", "c", "d"], 2, 0)).toEqual(["c", "a", "b", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 1, 3)).toEqual(["a", "c", "d", "b"]);
    expect(moveItem(["a", "b", "c", "d"], 0, 3)).toEqual(["b", "c", "d", "a"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
  });

  it("moves across rows (index jumps larger than one)", () => {
    // 4-column grid: index 5 is row 2 col 2, index 1 is row 1 col 2.
    const grid = ["r1c1", "r1c2", "r1c3", "r1c4", "r2c1", "r2c2", "r2c3"];
    expect(moveItem(grid, 5, 1)).toEqual(["r1c1", "r2c2", "r1c2", "r1c3", "r1c4", "r2c1", "r2c3"]);
    expect(moveItem(grid, 1, 5)).toEqual(["r1c1", "r1c3", "r1c4", "r2c1", "r2c2", "r1c2", "r2c3"]);
  });

  it("is a no-op for same or out-of-range indexes and never mutates", () => {
    const start = ["a", "b", "c"];
    expect(moveItem(start, 1, 1)).toEqual(["a", "b", "c"]);
    expect(moveItem(start, -1, 2)).toEqual(["a", "b", "c"]);
    expect(moveItem(start, 0, 9)).toEqual(["a", "b", "c"]);
    expect(moveItem(start, 9, 0)).toEqual(["a", "b", "c"]);
    expect(start).toEqual(["a", "b", "c"]);
  });

  it("resolves a fresh drop target on top of a stale preview", () => {
    // Live preview swept the card to the end; the pointer was released back
    // over "b". Applying the fresh target lands exactly on "b", not one past.
    expect(moveItemByKey(["b", "c", "a"], "a", "b")).toEqual(["a", "b", "c"]);
    expect(moveItemByKey(["p", "d", "f"], "f", "d")).toEqual(["p", "f", "d"]);
  });

  it("keeps the preview untouched when keys are missing or equal", () => {
    const preview = ["p", "f", "d"];
    expect(moveItemByKey(preview, "f", "f")).toEqual(preview);
    expect(moveItemByKey(preview, "zzz", "d")).toEqual(preview);
    expect(moveItemByKey(preview, "f", "zzz")).toEqual(preview);
    // The returned array is a copy, never the same reference.
    expect(moveItemByKey(preview, "f", "f")).not.toBe(preview);
  });

  it("keeps every element through repeated sequences", () => {
    let order = ["a", "b", "c", "d", "e", "f"];
    const moves: Array<[number, number]> = [
      [0, 3],
      [4, 1],
      [2, 2],
      [5, 0],
      [1, 4],
      [3, 2],
    ];
    for (const [from, to] of moves) {
      order = moveItem(order, from, to);
      expect([...order].sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
    }
    expect(order).toEqual(["f", "e", "d", "c", "b", "a"]);
  });
});

describe("moveItemByKey", () => {
  it("moves by key and ignores unknown or identical keys", () => {
    expect(moveItemByKey(["a", "b", "c"], "b", "c")).toEqual(["a", "c", "b"]);
    expect(moveItemByKey(["a", "b", "c"], "b", "b")).toEqual(["a", "b", "c"]);
    expect(moveItemByKey(["a", "b", "c"], "zzz", "c")).toEqual(["a", "b", "c"]);
    expect(moveItemByKey(["a", "b", "c"], "a", "zzz")).toEqual(["a", "b", "c"]);
  });
});

describe("resolveDropOrder", () => {
  const origin = ["a", "b", "c", "d"];

  it("commits the preview as-is on a direct release hit (no double move)", () => {
    // Hover swept "b" one slot right; the release overshoots onto "d".
    // Re-applying the hit on top of the preview would land two slots away.
    const preview = ["a", "c", "b", "d"];
    expect(resolveDropOrder(origin, preview, "b", "d", true)).toEqual(preview);
  });

  it("commits the preview when the release drifts back over the swap partner", () => {
    const preview = ["a", "c", "b", "d"];
    expect(resolveDropOrder(origin, preview, "b", "c", true)).toEqual(preview);
  });

  it("keeps the preview on a release over a gap or the dragged card's slot", () => {
    const preview = ["a", "c", "b", "d"];
    expect(resolveDropOrder(origin, preview, "b", "b", false)).toEqual(preview);
  });

  it("resolves a fast flick with no preview against the origin order", () => {
    expect(resolveDropOrder(origin, [], "a", "c", true)).toEqual(["b", "c", "a", "d"]);
  });

  it("is a no-op for a flick with no direct hit or no net move", () => {
    expect(resolveDropOrder(origin, [], "b", "b", false)).toEqual(origin);
    expect(resolveDropOrder(origin, [], "b", "b", true)).toEqual(origin);
  });

  it("treats an out-and-back preview as a no-op, not a phantom move", () => {
    expect(resolveDropOrder(origin, [...origin], "a", "b", true)).toEqual(origin);
  });

  it("never returns the input references", () => {
    const preview = ["a", "c", "b", "d"];
    expect(resolveDropOrder(origin, preview, "b", "d", true)).not.toBe(preview);
    expect(resolveDropOrder(origin, preview, "b", "d", true)).not.toBe(origin);
    expect(resolveDropOrder(origin, [], "b", "b", false)).not.toBe(origin);
  });
});

describe("mergeVisibleOrder", () => {
  it("maps a fully visible reorder straight through", () => {
    expect(mergeVisibleOrder(["a", "b", "c"], ["b", "a", "c"])).toEqual(["b", "a", "c"]);
  });

  it("preserves hidden items around a filtered reorder", () => {
    // Full list has hidden items (x, z); visible subset [b, d] swapped.
    expect(mergeVisibleOrder(["x", "a", "b", "c", "d", "z"], ["d", "b"])).toEqual([
      "x",
      "a",
      "d",
      "c",
      "b",
      "z",
    ]);
  });

  it("works on a reversed base list", () => {
    expect(mergeVisibleOrder(["d", "c", "b", "a"], ["b", "d", "c", "a"])).toEqual([
      "b",
      "d",
      "c",
      "a",
    ]);
  });

  it("leaves everything untouched when nothing is visibly reordered", () => {
    expect(mergeVisibleOrder(["a", "b"], [])).toEqual(["a", "b"]);
    expect(mergeVisibleOrder(["x", "a", "b"], ["a", "b"])).toEqual(["x", "a", "b"]);
  });
});
