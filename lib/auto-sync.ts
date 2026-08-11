// Background auto-sync preference: how often (in minutes) the desktop app
// reconciles with the configured sync server on its own, on top of the startup
// sync and the manual "Sync now". 0 means off. Stored locally per install (a
// personal convenience, not synced), so this is a small, SSR-safe, testable
// helper — the actual scheduling lives in the dashboard.

const KEY = "snipvault:autoSyncMinutes";

// The intervals offered in Settings. 0 = off.
export const AUTO_SYNC_OPTIONS = [0, 5, 15, 30, 60] as const;

function isValid(n: number): boolean {
  return (AUTO_SYNC_OPTIONS as readonly number[]).includes(n);
}

// The saved interval in minutes, or 0 (off) when unset/invalid/unavailable.
export function getAutoSyncMinutes(): number {
  if (typeof window === "undefined") return 0;
  try {
    const n = Number(window.localStorage.getItem(KEY));
    return isValid(n) ? n : 0;
  } catch {
    return 0;
  }
}

// Persist the interval. An invalid value is coerced to 0 (off); 0 clears the key.
export function setAutoSyncMinutes(minutes: number): void {
  if (typeof window === "undefined") return;
  const valid = isValid(minutes) ? minutes : 0;
  try {
    if (valid === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, String(valid));
  } catch {
    // Storage blocked — auto-sync is a convenience; ignore.
  }
}

// A short human label for an interval, for the Settings control.
export function autoSyncLabel(minutes: number): string {
  return minutes > 0 ? `Every ${minutes} min` : "Off";
}
