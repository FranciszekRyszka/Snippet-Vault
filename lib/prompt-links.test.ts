import { describe, it, expect } from "vitest";
import { extractLinks, resolveLink, backlinksFor } from "./prompt-links";
import type { Snippet } from "@/lib/tauri-api";

// Minimal Snippet factory — only the fields the link helpers read matter.
function snip(partial: Partial<Snippet> & { id: number }): Snippet {
  return {
    id: partial.id,
    uuid: partial.uuid ?? `u${partial.id}`,
    title: partial.title ?? "",
    description: "",
    code: partial.code ?? "",
    language: "text",
    tags: [],
    favorite: false,
    model: "",
    kind: partial.kind ?? "prompt",
    color: partial.color ?? "",
    template: partial.template ?? false,
    last_device: partial.last_device ?? "",
    collection: partial.collection ?? "",
    icon: partial.icon ?? "",
    copy_count: 0,
    last_used_at: null,
    created_at: "",
    updated_at: "",
  };
}

describe("extractLinks", () => {
  it("finds distinct link targets in first-seen order", () => {
    expect(extractLinks("See [[Base prompt]] and [[Style guide]]")).toEqual([
      "Base prompt",
      "Style guide",
    ]);
  });
  it("trims and de-duplicates case-insensitively, keeping the first spelling", () => {
    expect(extractLinks("[[ Base ]] then [[base]] then [[BASE]]")).toEqual([
      "Base",
    ]);
  });
  it("ignores empty links and never spans brackets or newlines", () => {
    expect(extractLinks("[[]] and [[a\nb]] and text")).toEqual([]);
  });
  it("returns nothing when there are no links", () => {
    expect(extractLinks("just prose, no links")).toEqual([]);
  });
});

describe("resolveLink", () => {
  const lib = [snip({ id: 1, title: "Base prompt" }), snip({ id: 2, title: "Other" })];
  it("matches a title case-insensitively", () => {
    expect(resolveLink("base PROMPT", lib)?.id).toBe(1);
  });
  it("returns undefined when nothing matches", () => {
    expect(resolveLink("missing", lib)).toBeUndefined();
  });
});

describe("backlinksFor", () => {
  const base = snip({ id: 1, title: "Base" });
  it("finds prompts that link to the snippet's title", () => {
    const a = snip({ id: 2, title: "A", code: "uses [[Base]] here" });
    const b = snip({ id: 3, title: "B", code: "no link" });
    expect(backlinksFor(base, [base, a, b]).map((s) => s.id)).toEqual([2]);
  });
  it("ignores code snippets, whose [[ ]] is literal syntax", () => {
    const shell = snip({
      id: 2,
      title: "Guard",
      kind: "code",
      code: "if [[ -f base ]]; then :; fi",
    });
    // Even though the text contains [[ base ]], a code snippet is never a linker,
    // and the title differs anyway.
    const linker = snip({ id: 3, title: "Ref", code: "[[Base]]", kind: "code" });
    expect(backlinksFor(base, [base, shell, linker])).toEqual([]);
  });
  it("never counts the snippet itself", () => {
    const selfRef = snip({ id: 1, title: "Base", code: "I mention [[Base]]" });
    expect(backlinksFor(selfRef, [selfRef])).toEqual([]);
  });
});
