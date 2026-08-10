import { beforeEach, describe, expect, it } from "vitest";
import {
  isValidLauncherUrl,
  loadCustomLaunchers,
  saveCustomLaunchers,
  type Launcher,
} from "./launchers";

// A minimal in-memory localStorage so the SSR-safe store can run under Node
// (vitest's default environment has no window) — mirrors lib/var-store.test.ts.
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

describe("isValidLauncherUrl", () => {
  it("accepts http(s) URLs", () => {
    expect(isValidLauncherUrl("https://example.com/")).toBe(true);
    expect(isValidLauncherUrl("http://localhost:3000")).toBe(true);
  });

  it("rejects non-http schemes and junk", () => {
    // eslint-disable-next-line no-script-url
    expect(isValidLauncherUrl("javascript:alert(1)")).toBe(false);
    expect(isValidLauncherUrl("file:///etc/passwd")).toBe(false);
    expect(isValidLauncherUrl("not a url")).toBe(false);
    expect(isValidLauncherUrl("")).toBe(false);
  });
});

describe("custom launchers storage", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installLocalStorage();
  });

  it("round-trips a saved list", () => {
    const list: Launcher[] = [{ id: "a", name: "A", url: "https://a.test/" }];
    saveCustomLaunchers(list);
    expect(loadCustomLaunchers()).toEqual(list);
  });

  it("returns [] when nothing is stored", () => {
    expect(loadCustomLaunchers()).toEqual([]);
  });

  it("drops malformed or unsafe entries", () => {
    store.set(
      "snipvault:launchers",
      JSON.stringify([
        { id: "ok", name: "Good", url: "https://good.test/" },
        { id: "bad-url", name: "Bad", url: "javascript:evil" },
        { id: "missing-name", url: "https://x.test/" },
        "nonsense",
      ])
    );
    expect(loadCustomLaunchers()).toEqual([
      { id: "ok", name: "Good", url: "https://good.test/" },
    ]);
  });

  it("tolerates corrupt JSON", () => {
    store.set("snipvault:launchers", "{not json");
    expect(loadCustomLaunchers()).toEqual([]);
  });
});
