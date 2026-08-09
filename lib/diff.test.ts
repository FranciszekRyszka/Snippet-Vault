import { describe, expect, it } from "vitest";
import { diffLines, diffStats } from "./diff";

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
