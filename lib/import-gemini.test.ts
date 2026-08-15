import { describe, it, expect } from "vitest";
import { isGeminiExport, parseGeminiExport } from "./import-gemini";

function item(
  title: string,
  opts: { header?: string; products?: string[] } = {}
) {
  return {
    header: opts.header ?? "Gemini Apps",
    title,
    time: "2026-01-01T00:00:00Z",
    ...(opts.products ? { products: opts.products } : {}),
  };
}

describe("isGeminiExport", () => {
  it("recognizes a My Activity array with a Gemini 'Prompted' item", () => {
    expect(isGeminiExport([item("Prompted Write a haiku")])).toBe(true);
  });

  it("recognizes a Bard-labelled export too", () => {
    expect(
      isGeminiExport([item("Prompted Hello", { header: "Bard" })])
    ).toBe(true);
  });

  it("rejects a Search activity export (no Gemini prompt items)", () => {
    expect(
      isGeminiExport([item("Searched for cats", { header: "Search" })])
    ).toBe(false);
  });

  it("rejects non-arrays / empty", () => {
    expect(isGeminiExport({})).toBe(false);
    expect(isGeminiExport([])).toBe(false);
  });
});

describe("parseGeminiExport", () => {
  it("strips the 'Prompted ' prefix to recover the prompt body", () => {
    const out = parseGeminiExport([item("Prompted Write a haiku about autumn")]);
    expect(out).toEqual([
      { title: "Write a haiku about autumn", body: "Write a haiku about autumn" },
    ]);
  });

  it("keeps only Gemini prompt items, skipping other activity", () => {
    const out = parseGeminiExport([
      item("Prompted First prompt"),
      item("Searched for something", { header: "Search" }),
      item("Opened Gemini"),
    ]);
    expect(out.map((p) => p.body)).toEqual(["First prompt"]);
  });

  it("returns [] for malformed input", () => {
    expect(parseGeminiExport(null)).toEqual([]);
    expect(parseGeminiExport([1, null, "x"])).toEqual([]);
  });
});
