// Remembered prompt-variable values. When a prompt with `{{placeholders}}` is
// copied, the values the user typed are saved per-prompt so the fill dialog can
// pre-fill them next time. Stored in localStorage keyed by the prompt's stable
// `uuid` — a personal, per-install convenience, deliberately not synced.
//
// Pure and SSR-safe (guards `window`), so it's unit-testable and never throws on
// the server or on corrupt/missing storage.

const KEY_PREFIX = "snipvault:vars:";

function keyFor(uuid: string): string {
  return `${KEY_PREFIX}${uuid}`;
}

// The last-used values for a prompt, or `{}` when there's nothing saved (or the
// stored value is missing/corrupt/not an object).
export function loadVarValues(uuid: string): Record<string, string> {
  if (!uuid || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(keyFor(uuid));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") out[name] = value;
    }
    return out;
  } catch {
    return {};
  }
}

// Persist the values for a prompt. Only non-empty values are kept, and only for
// the variable names the prompt currently has (`keep`) — so renamed or removed
// placeholders don't accumulate stale entries. Saving an empty result removes
// the key entirely.
export function saveVarValues(
  uuid: string,
  values: Record<string, string>,
  keep: string[],
): void {
  if (!uuid || typeof window === "undefined") return;
  const allowed = new Set(keep);
  const trimmed: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    if (allowed.has(name) && value) trimmed[name] = value;
  }
  try {
    if (Object.keys(trimmed).length === 0) {
      window.localStorage.removeItem(keyFor(uuid));
    } else {
      window.localStorage.setItem(keyFor(uuid), JSON.stringify(trimmed));
    }
  } catch {
    // Storage full or unavailable — remembering values is best-effort.
  }
}
