import { beforeEach, describe, expect, it } from "vitest";
import { loadVarValues, saveVarValues } from "./var-store";

// A minimal in-memory localStorage so the SSR-safe store can be exercised under
// Node (vitest's default environment has no window).
function installLocalStorage() {
  const store = new Map<string, string>();
  const mock = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  (globalThis as unknown as { window: unknown }).window = { localStorage: mock };
  return store;
}

describe("var-store", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("round-trips saved values per uuid", () => {
    saveVarValues("u1", { topic: "cats", tone: "playful" }, ["topic", "tone"]);
    expect(loadVarValues("u1")).toEqual({ topic: "cats", tone: "playful" });
  });

  it("keeps values isolated by uuid", () => {
    saveVarValues("u1", { topic: "cats" }, ["topic"]);
    saveVarValues("u2", { topic: "dogs" }, ["topic"]);
    expect(loadVarValues("u1")).toEqual({ topic: "cats" });
    expect(loadVarValues("u2")).toEqual({ topic: "dogs" });
  });

  it("drops empty values and prunes names no longer in the prompt", () => {
    // `stale` isn't in `keep`; `blank` is empty — both should be dropped.
    saveVarValues("u1", { topic: "cats", stale: "x", blank: "" }, ["topic", "blank"]);
    expect(loadVarValues("u1")).toEqual({ topic: "cats" });
  });

  it("removes the key entirely when nothing is worth keeping", () => {
    saveVarValues("u1", { topic: "cats" }, ["topic"]);
    saveVarValues("u1", { topic: "" }, ["topic"]);
    expect(loadVarValues("u1")).toEqual({});
  });

  it("returns {} for missing, empty-uuid, and corrupt entries", () => {
    expect(loadVarValues("nope")).toEqual({});
    expect(loadVarValues("")).toEqual({});
    window.localStorage.setItem("snipvault:vars:bad", "{not json");
    expect(loadVarValues("bad")).toEqual({});
    window.localStorage.setItem("snipvault:vars:arr", "[1,2,3]");
    expect(loadVarValues("arr")).toEqual({});
  });

  it("ignores non-string stored values", () => {
    window.localStorage.setItem(
      "snipvault:vars:mixed",
      JSON.stringify({ a: "keep", b: 5, c: null }),
    );
    expect(loadVarValues("mixed")).toEqual({ a: "keep" });
  });
});
