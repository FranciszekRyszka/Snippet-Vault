import { describe, it, expect } from "vitest";
import {
  escapeLike,
  sanitizeTags,
  sanitizeModel,
  sanitizeKind,
  parseId,
  validTimestampOr,
  ftsMatchQuery,
} from "./api-utils";

// These pure helpers guard every web write path and mirror the desktop's
// src-tauri/src/validation.rs. They're the highest-value unit tests: fast, no
// server or database, and they pin down the exact normalization rules.

describe("sanitizeKind", () => {
  it("keeps 'code', defaults everything else to 'prompt'", () => {
    expect(sanitizeKind("code")).toBe("code");
    expect(sanitizeKind(" code ")).toBe("code"); // trimmed
    expect(sanitizeKind("prompt")).toBe("prompt");
    expect(sanitizeKind("nonsense")).toBe("prompt");
    expect(sanitizeKind(undefined)).toBe("prompt");
    expect(sanitizeKind(42)).toBe("prompt");
  });
});

describe("sanitizeTags", () => {
  it("lowercases, trims, drops empties, dedupes", () => {
    expect(sanitizeTags(["  A ", "a", "b", ""])).toEqual(["a", "b"]);
  });
  it("ignores non-arrays and non-string items", () => {
    expect(sanitizeTags("nope")).toEqual([]);
    expect(sanitizeTags([1, null, "ok"])).toEqual(["ok"]);
  });
  it("caps at 20 tags", () => {
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`);
    expect(sanitizeTags(many)).toHaveLength(20);
  });
});

describe("sanitizeModel", () => {
  it("trims and caps at 100 chars; non-strings become ''", () => {
    expect(sanitizeModel("  gpt-4o  ")).toBe("gpt-4o");
    expect(sanitizeModel(123)).toBe("");
    expect(sanitizeModel("x".repeat(200))).toHaveLength(100);
  });
});

describe("parseId", () => {
  it("accepts only plain non-negative integers", () => {
    expect(parseId("7")).toBe(7);
    expect(parseId("0")).toBe(0);
    expect(parseId("7abc")).toBeNull();
    expect(parseId("1e2")).toBeNull();
    expect(parseId("-3")).toBeNull();
    expect(parseId("")).toBeNull();
  });
});

describe("validTimestampOr", () => {
  it("accepts a stored-format timestamp", () => {
    expect(validTimestampOr("2026-08-04 10:00:00", null)).toBe(
      "2026-08-04 10:00:00"
    );
  });
  it("falls back for bad shapes or bogus dates", () => {
    expect(validTimestampOr("not-a-date", null)).toBeNull();
    expect(validTimestampOr("2026-08-04T10:00:00", "fb")).toBe("fb"); // wrong separator
    expect(validTimestampOr(12345, null)).toBeNull();
  });
});

describe("ftsMatchQuery", () => {
  it("quotes each token as a prefix term, AND-ed", () => {
    expect(ftsMatchQuery("lazy dog")).toBe('"lazy"* "dog"*');
  });
  it("splits on punctuation and drops empties", () => {
    expect(ftsMatchQuery("foo-bar, baz")).toBe('"foo"* "bar"* "baz"*');
  });
  it("keeps unicode letters/numbers as single tokens", () => {
    expect(ftsMatchQuery("Übersetzung 2024")).toBe('"Übersetzung"* "2024"*');
  });
  it("returns null when there are no searchable tokens", () => {
    expect(ftsMatchQuery("%")).toBeNull();
    expect(ftsMatchQuery("   ")).toBeNull();
    expect(ftsMatchQuery("!!! ??? ...")).toBeNull();
  });
  it("turns an injection-y string into plain tokens", () => {
    expect(ftsMatchQuery('" OR 1=1 --')).toBe('"OR"* "1"* "1"*');
  });
  it("neutralizes FTS syntax characters (no quotes/stars/colons leak)", () => {
    const q = ftsMatchQuery('near("a" b):c*');
    // Every term is wrapped; no bare FTS operator survives.
    expect(q).toBe('"near"* "a"* "b"* "c"*');
  });
});

describe("escapeLike", () => {
  it("escapes LIKE wildcards so input matches literally", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("c\\d")).toBe("c\\\\d");
  });
});
