import { describe, it, expect } from "vitest";
import { normalizeForDup, findDuplicateGroups } from "./duplicates";
import type { Snippet } from "@/lib/tauri-api";

function snip(partial: Partial<Snippet> & { id: number }): Snippet {
  return {
    id: partial.id,
    uuid: partial.uuid ?? `u${partial.id}`,
    title: partial.title ?? `T${partial.id}`,
    description: "",
    code: partial.code ?? "",
    language: "text",
    tags: [],
    favorite: false,
    model: "",
    kind: partial.kind ?? "prompt",
    color: partial.color ?? "",
    template: partial.template ?? false,
    copy_count: 0,
    last_used_at: null,
    created_at: "",
    updated_at: "",
  };
}

describe("normalizeForDup", () => {
  it("trims and collapses all whitespace to single spaces", () => {
    expect(normalizeForDup("  a\t b\n\n c  ")).toBe("a b c");
  });
  it("makes reformatted-but-identical bodies compare equal", () => {
    expect(normalizeForDup("Write a\nhaiku")).toBe(normalizeForDup("Write a haiku"));
  });
  it("keeps case distinct", () => {
    expect(normalizeForDup("Hello")).not.toBe(normalizeForDup("hello"));
  });
});

describe("findDuplicateGroups", () => {
  it("groups entries with the same normalized content", () => {
    const a = snip({ id: 1, code: "same body" });
    const b = snip({ id: 2, code: "same   body" }); // whitespace differs only
    const c = snip({ id: 3, code: "different" });
    const groups = findDuplicateGroups([a, b, c]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((s) => s.id).sort()).toEqual([1, 2]);
  });
  it("ignores lone entries and empty bodies", () => {
    expect(
      findDuplicateGroups([
        snip({ id: 1, code: "unique" }),
        snip({ id: 2, code: "   " }),
        snip({ id: 3, code: "" }),
      ])
    ).toEqual([]);
  });
  it("orders groups largest-first", () => {
    const groups = findDuplicateGroups([
      snip({ id: 1, code: "pair" }),
      snip({ id: 2, code: "pair" }),
      snip({ id: 3, code: "trio" }),
      snip({ id: 4, code: "trio" }),
      snip({ id: 5, code: "trio" }),
    ]);
    expect(groups.map((g) => g.length)).toEqual([3, 2]);
  });
});
