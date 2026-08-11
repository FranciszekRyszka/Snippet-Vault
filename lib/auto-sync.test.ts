import { beforeEach, describe, it, expect } from "vitest";
import {
  getAutoSyncMinutes,
  setAutoSyncMinutes,
  autoSyncLabel,
  AUTO_SYNC_OPTIONS,
} from "./auto-sync";

// A minimal in-memory localStorage so the SSR-safe helper can be exercised under
// Node (vitest's default environment has no window). Mirrors var-store.test.ts.
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

describe("auto-sync preference", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installLocalStorage();
  });

  it("defaults to off (0)", () => {
    expect(getAutoSyncMinutes()).toBe(0);
  });

  it("round-trips a valid interval", () => {
    setAutoSyncMinutes(15);
    expect(getAutoSyncMinutes()).toBe(15);
  });

  it("coerces an invalid interval to off and clears on 0", () => {
    setAutoSyncMinutes(7); // not an offered option
    expect(getAutoSyncMinutes()).toBe(0);
    setAutoSyncMinutes(30);
    expect(getAutoSyncMinutes()).toBe(30);
    setAutoSyncMinutes(0);
    expect(getAutoSyncMinutes()).toBe(0);
    expect(store.has("snipvault:autoSyncMinutes")).toBe(false);
  });

  it("offers off plus a few intervals", () => {
    expect(AUTO_SYNC_OPTIONS).toEqual([0, 5, 15, 30, 60]);
  });

  it("labels intervals and off", () => {
    expect(autoSyncLabel(0)).toBe("Off");
    expect(autoSyncLabel(15)).toBe("Every 15 min");
  });
});
