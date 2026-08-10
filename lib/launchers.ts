// "Run in…" launcher targets: sites a prompt can be sent to (the prompt is
// copied to the clipboard and the site opened, so the user can paste). A few
// popular defaults ship built-in; users can add their own, stored per-install in
// localStorage. Pure + SSR-safe so it's unit-testable and importable anywhere.

export type Launcher = { id: string; name: string; url: string };

export const DEFAULT_LAUNCHERS: Launcher[] = [
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/" },
  { id: "claude", name: "Claude", url: "https://claude.ai/new" },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/app" },
  { id: "aistudio", name: "AI Studio", url: "https://aistudio.google.com/" },
];

const KEY = "snipvault:launchers";

// Only http(s) targets are allowed — the opener plugin is scoped to those, and
// it keeps a stray `javascript:`/`file:` URL out of the launcher.
export function isValidLauncherUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

// The user's custom launchers (SSR-safe). Tolerates missing/corrupt storage and
// drops any malformed entries, returning [] rather than throwing.
export function loadCustomLaunchers(): Launcher[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (l): l is Launcher =>
        l &&
        typeof l.id === "string" &&
        typeof l.name === "string" &&
        typeof l.url === "string" &&
        isValidLauncherUrl(l.url)
    );
  } catch {
    return [];
  }
}

export function saveCustomLaunchers(list: Launcher[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // ignore storage failures (private mode / blocked storage)
  }
}

// Built-in defaults followed by the user's custom targets.
export function allLaunchers(): Launcher[] {
  return [...DEFAULT_LAUNCHERS, ...loadCustomLaunchers()];
}
