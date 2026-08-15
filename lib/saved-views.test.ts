import { beforeEach, describe, expect, it } from "vitest";
import {
  addView,
  removeView,
  loadViews,
  hasActiveFilters,
  type ViewFilters,
} from "./saved-views";

function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    },
  };
}

const base: ViewFilters = {
  search: "",
  searchMode: "all",
  language: "",
  activeTag: "",
  favoritesOnly: false,
  activeModel: "",
  activeCollection: "",
  kind: "all",
  sort: "recent",
};

describe("saved-views", () => {
  beforeEach(() => installLocalStorage());

  it("adds and lists a view", () => {
    addView("Refactors", { ...base, activeTag: "refactor" });
    const views = loadViews();
    expect(views).toHaveLength(1);
    expect(views[0].name).toBe("Refactors");
    expect(views[0].filters.activeTag).toBe("refactor");
    expect(views[0].id).toBeTruthy();
  });

  it("replaces a view with a duplicate name (case-insensitive)", () => {
    addView("Work", { ...base, language: "python" });
    addView("work", { ...base, language: "rust" });
    const views = loadViews();
    expect(views).toHaveLength(1);
    expect(views[0].filters.language).toBe("rust");
  });

  it("ignores an empty name", () => {
    addView("   ", { ...base, favoritesOnly: true });
    expect(loadViews()).toHaveLength(0);
  });

  it("removes a view by id", () => {
    addView("A", { ...base, search: "a" });
    const [{ id }] = loadViews();
    const after = removeView(id);
    expect(after).toHaveLength(0);
    expect(loadViews()).toHaveLength(0);
  });

  it("tolerates a corrupt store", () => {
    window.localStorage.setItem("snipvault:views", "{not an array");
    expect(loadViews()).toEqual([]);
  });

  it("hasActiveFilters reflects whether anything is narrowed", () => {
    expect(hasActiveFilters(base)).toBe(false);
    expect(hasActiveFilters({ ...base, activeModel: "claude" })).toBe(true);
    expect(hasActiveFilters({ ...base, kind: "code" })).toBe(true);
    expect(hasActiveFilters({ ...base, sort: "most-used" })).toBe(true);
  });
});
