import { describe, expect, it } from "vitest";
import { diffLines, diffStats, alignedDiff } from "./diff";

describe("diffLines", () => {
  it("marks every line the same for identical text", () => {
    const d = diffLines("a\nb\nc", "a\nb\nc");
    expect(d.every((l) => l.type === "same")).toBe(true);
    expect(d.map((l) => l.text)).toEqual(["a", "b", "c"]);
  });

  it("detects a changed line as a delete + add", () => {
    const d = diffLines("a\nb\nc", "a\nB\nc");
    expect(d).toEqual([
      { type: "same", text: "a" },
      { type: "del", text: "b" },
      { type: "add", text: "B" },
      { type: "same", text: "c" },
    ]);
  });

  it("detects a pure insertion", () => {
    const d = diffLines("a\nc", "a\nb\nc");
    expect(d).toEqual([
      { type: "same", text: "a" },
      { type: "add", text: "b" },
      { type: "same", text: "c" },
    ]);
  });

  it("detects a pure deletion", () => {
    const d = diffLines("a\nb\nc", "a\nc");
    expect(d).toEqual([
      { type: "same", text: "a" },
      { type: "del", text: "b" },
      { type: "same", text: "c" },
    ]);
  });

  it("handles all-added (empty old) and all-removed (empty new)", () => {
    // Splitting "" yields one empty line, so compare non-empty vs empty text.
    const added = diffLines("", "x\ny");
    expect(diffStats(added)).toEqual({ added: 2, removed: 1 });
    const removed = diffLines("x\ny", "");
    expect(diffStats(removed)).toEqual({ added: 1, removed: 2 });
  });

  it("preserves a common subsequence across scattered edits", () => {
    const d = diffLines("one\ntwo\nthree", "one\nthree\nfour");
    expect(d).toEqual([
      { type: "same", text: "one" },
      { type: "del", text: "two" },
      { type: "same", text: "three" },
      { type: "add", text: "four" },
    ]);
  });
});

describe("alignedDiff", () => {
  it("mirrors identical text on both sides, all unchanged", () => {
    const rows = alignedDiff("a\nb", "a\nb");
    expect(rows).toEqual([
      { left: "a", right: "a", changed: false },
      { left: "b", right: "b", changed: false },
    ]);
  });

  it("pairs an edited line: old on the left, new on the right", () => {
    const rows = alignedDiff("a\nb\nc", "a\nB\nc");
    expect(rows).toEqual([
      { left: "a", right: "a", changed: false },
      { left: "b", right: "B", changed: true },
      { left: "c", right: "c", changed: false },
    ]);
  });

  it("uses a spacer opposite a pure insertion or deletion", () => {
    expect(alignedDiff("a\nc", "a\nb\nc")).toEqual([
      { left: "a", right: "a", changed: false },
      { left: null, right: "b", changed: true },
      { left: "c", right: "c", changed: false },
    ]);
    expect(alignedDiff("a\nb\nc", "a\nc")).toEqual([
      { left: "a", right: "a", changed: false },
      { left: "b", right: null, changed: true },
      { left: "c", right: "c", changed: false },
    ]);
  });

  it("pairs surplus edits, padding the shorter side with spacers", () => {
    // one line replaced by two: b → x, y
    expect(alignedDiff("a\nb", "a\nx\ny")).toEqual([
      { left: "a", right: "a", changed: false },
      { left: "b", right: "x", changed: true },
      { left: null, right: "y", changed: true },
    ]);
  });
});

describe("diffStats", () => {
  it("counts adds and removes", () => {
    const d = diffLines("a\nb\nc", "a\nx\ny\nc");
    expect(diffStats(d)).toEqual({ added: 2, removed: 1 });
  });

  it("is zero for identical text", () => {
    expect(diffStats(diffLines("same\ntext", "same\ntext"))).toEqual({
      added: 0,
      removed: 0,
    });
  });
});
