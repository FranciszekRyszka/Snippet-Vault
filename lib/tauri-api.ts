// Entry kind: a runnable prompt vs. a plain code snippet. Governs whether the
// UI shows the (~token) estimate, which is meaningless for code.
export type SnippetKind = "prompt" | "code";

// Snippet type definition (shared between frontend and backend)
export type Snippet = {
  id: number;
  uuid: string;
  title: string;
  description: string;
  code: string;
  language: string;
  tags: string[];
  favorite: boolean;
  model: string;
  kind: SnippetKind;
  copy_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateSnippetInput = {
  title: string;
  description?: string;
  code: string;
  language: string;
  tags?: string[];
  model?: string;
  kind?: SnippetKind;
};

export type UpdateSnippetInput = {
  title: string;
  description?: string;
  code: string;
  language: string;
  tags?: string[];
  model?: string;
  kind?: SnippetKind;
};

// Check if running in Tauri.
// __TAURI_INTERNALS__ is always injected by the Tauri v2 webview, unlike
// __TAURI__ which requires `app.withGlobalTauri: true` in tauri.conf.json.
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Tauri invoke wrapper with type safety
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error("Not running in Tauri");
  }
  // Dynamic import to avoid SSR issues
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

// ---- Runtime mode ---------------------------------------------------------
//
// Snippet operations always run against the LOCAL database:
//   * web     — a browser: same-origin fetch to the Next.js API routes.
//   * desktop — Tauri `invoke` into the bundled rusqlite database.
//
// A configured sync server is NOT a live backend — it's a peer the desktop app
// reconciles against on demand (see `syncNow`). Its config lives in the Rust
// config.json and is cached here after the first read.

export type SyncServer = { url: string; token: string };

let syncServer: SyncServer | null = null;
let syncServerLoaded = false;

// Read (once) the configured sync server, if any. Only the desktop app can have
// one; in the browser this is always null.
async function loadSyncServer(): Promise<SyncServer | null> {
  if (!isTauri()) return null;
  if (syncServerLoaded) return syncServer;
  try {
    syncServer = await invoke<SyncServer | null>("get_remote_config");
  } catch {
    syncServer = null;
  }
  syncServerLoaded = true;
  return syncServer;
}

// The saved sync server, or null when none is configured. Public so the UI can
// show status and enable the "Sync now" action.
export async function getSyncServer(): Promise<SyncServer | null> {
  return loadSyncServer();
}

// Snippet operations use the local backend in every mode: Tauri `invoke` on the
// desktop, same-origin fetch in the browser. Async so call sites keep the
// `await useLocalDb()` form they already use.
async function useLocalDb(): Promise<boolean> {
  return isTauri();
}

// The Tauri HTTP plugin's fetch: same signature as the web fetch, but the
// request is made from Rust, bypassing the webview CSP and server CORS. Used
// only to talk to the sync server (never for local snippet ops).
async function tauriHttpFetch(): Promise<typeof fetch> {
  const mod = await import("@tauri-apps/plugin-http");
  return mod.fetch as typeof fetch;
}

// Same-origin fetch to the local Next.js API. Web runtime only — the desktop
// app never reaches here (it uses `invoke`).
async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, init);
}

// Throw a useful Error for a non-OK web response, preferring the server's own
// `{ error }` message so callers can surface it. Only consumes the body on
// failure, leaving res.json() available to the caller on success.
async function throwIfNotOk(res: Response, fallback: string): Promise<void> {
  if (res.ok) return;
  let message = fallback;
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") message = body.error;
  } catch {
    // No JSON body; keep the fallback message.
  }
  throw new Error(message);
}

// ---- Sync server (desktop only) -------------------------------------------

// Verify a sync server is reachable and the token is accepted, then save it.
// This does NOT change how snippets are read/written (still local) — it just
// enables syncing. Throws a friendly message on failure so the caller can show
// it without saving a broken config.
export async function saveSyncServer(url: string, token: string): Promise<void> {
  const normalized = url.trim().replace(/\/+$/, "");
  if (!normalized) throw new Error("Enter a server URL.");

  let res: Response;
  try {
    const doFetch = await tauriHttpFetch();
    res = await doFetch(`${normalized}/api/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error("Couldn't reach the server. Check the URL and that it's running.");
  }
  if (res.status === 401) throw new Error("Server rejected the token.");
  if (!res.ok) throw new Error(`Server error (HTTP ${res.status}).`);

  await invoke("set_remote_config", { url: normalized, token });
  syncServer = { url: normalized, token };
  syncServerLoaded = true;
}

// Forget the sync server. The local library is untouched.
export async function removeSyncServer(): Promise<void> {
  await invoke("clear_remote_config");
  syncServer = null;
  syncServerLoaded = true;
}

// A snippet as exchanged with the sync server: keyed by its stable `uuid`,
// carrying the `deleted` tombstone flag, without the local autoincrement id.
export type SyncRecord = Omit<Snippet, "id"> & { deleted: boolean };

export type SyncResult = {
  // How many local rows the incoming server data inserted or updated.
  applied: number;
  // Total live (non-deleted) snippets after the sync.
  total: number;
};

// Reconcile the local library with the configured sync server in one round
// trip: push every local record (tombstones included), receive the server's
// merged set, and apply it locally. Both sides converge to the union of
// records with the most recent edit winning per snippet.
export async function syncNow(): Promise<SyncResult> {
  if (!isTauri()) throw new Error("Sync is only available in the desktop app.");
  const server = await loadSyncServer();
  if (!server) throw new Error("No sync server configured.");

  const local = await invoke<SyncRecord[]>("get_all_for_sync");

  let res: Response;
  try {
    const doFetch = await tauriHttpFetch();
    res = await doFetch(`${server.url}/api/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({ records: local }),
    });
  } catch {
    throw new Error("Couldn't reach the sync server.");
  }
  if (res.status === 401) throw new Error("Server rejected the token.");
  if (!res.ok) throw new Error(`Sync failed (HTTP ${res.status}).`);

  const body = (await res.json()) as { records: SyncRecord[] };
  const applied = await invoke<number>("apply_sync_records", {
    records: body.records,
  });
  const total = body.records.filter((r) => !r.deleted).length;
  return { applied, total };
}

// API functions that work in browser, local desktop, and remote-server modes
export async function getSnippets(params?: {
  search?: string;
  language?: string;
  tag?: string;
  searchMode?: string;
  sort?: string;
}): Promise<Snippet[]> {
  if (await useLocalDb()) {
    return invoke<Snippet[]>("get_snippets", {
      search: params?.search || null,
      language: params?.language || null,
      tag: params?.tag || null,
      searchMode: params?.searchMode || null,
      sort: params?.sort || null,
    });
  }

  const searchParams = new URLSearchParams();
  if (params?.search) {
    searchParams.set("search", params.search);
    if (params.searchMode) searchParams.set("searchMode", params.searchMode);
  }
  if (params?.language) searchParams.set("language", params.language);
  if (params?.tag) searchParams.set("tag", params.tag);
  if (params?.sort) searchParams.set("sort", params.sort);

  const qs = searchParams.toString();
  const res = await apiFetch(`/api/snippets${qs ? `?${qs}` : ""}`);
  await throwIfNotOk(res, "Failed to fetch snippets");
  return res.json();
}

// The soft-deleted (tombstoned) entries, newest-deleted first — the Trash view.
// They're hidden from getSnippets(); restore one with restoreSnippet().
export async function getDeletedSnippets(): Promise<Snippet[]> {
  if (await useLocalDb()) {
    return invoke<Snippet[]>("get_deleted");
  }

  const res = await apiFetch("/api/snippets?deleted=1");
  await throwIfNotOk(res, "Failed to load deleted snippets");
  return res.json();
}

// Empty the Trash: permanently clear the content of every tombstone (the row is
// kept as a deleted tombstone so the deletion still syncs). Returns how many
// were purged.
export async function purgeTrash(): Promise<number> {
  if (await useLocalDb()) {
    return invoke<number>("purge_deleted");
  }

  const res = await apiFetch("/api/snippets/purge", { method: "POST" });
  await throwIfNotOk(res, "Failed to empty trash");
  const body = (await res.json()) as { purged: number };
  return body.purged;
}

// Rename, merge, or delete a tag across the whole library. `to = null` deletes
// the tag; renaming onto an existing tag merges them. Bumps `updated_at` on the
// changed rows so the change syncs (newest-wins). Returns how many rows changed.
export async function rewriteTag(from: string, to: string | null): Promise<number> {
  if (await useLocalDb()) {
    return invoke<number>("rewrite_tag", { from, to });
  }

  const res = await apiFetch("/api/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to }),
  });
  await throwIfNotOk(res, "Failed to update tag");
  const body = (await res.json()) as { changed: number };
  return body.changed ?? 0;
}

// Open an external URL in the user's default browser. On the desktop this goes
// through the OS via the opener plugin (never navigates the app's own webview);
// on the web it opens a new tab. Used by the per-prompt "Run in…" launcher.
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

// A past version of a snippet (prompt history). `saved_at` is the version's own
// last-saved time (its `updated_at` while it was live).
export type SnippetRevision = {
  id: number;
  title: string;
  description: string;
  code: string;
  language: string;
  tags: string[];
  model: string;
  kind: SnippetKind;
  saved_at: string;
};

// Past versions of a snippet, newest first. History is local to each database
// (not synced). Desktop looks up by the stable uuid; web by the row id.
export async function getRevisions(snippet: Snippet): Promise<SnippetRevision[]> {
  if (await useLocalDb()) {
    return invoke<SnippetRevision[]>("get_revisions", { uuid: snippet.uuid });
  }

  const res = await apiFetch(`/api/snippets/${snippet.id}/revisions`);
  await throwIfNotOk(res, "Failed to load revisions");
  return res.json();
}

export async function createSnippet(input: CreateSnippetInput): Promise<Snippet> {
  if (await useLocalDb()) {
    return invoke<Snippet>("create_snippet", { input });
  }

  const res = await apiFetch("/api/snippets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await throwIfNotOk(res, "Failed to create snippet");
  return res.json();
}

export async function updateSnippet(id: number, input: UpdateSnippetInput): Promise<Snippet | null> {
  if (await useLocalDb()) {
    return invoke<Snippet | null>("update_snippet", { id, input });
  }

  const res = await apiFetch(`/api/snippets/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await throwIfNotOk(res, "Failed to update snippet");
  return res.json();
}

export async function deleteSnippet(id: number): Promise<boolean> {
  if (await useLocalDb()) {
    return invoke<boolean>("delete_snippet", { id });
  }

  const res = await apiFetch(`/api/snippets/${id}`, { method: "DELETE" });
  await throwIfNotOk(res, "Failed to delete snippet");
  return true;
}

// Pin/unpin a snippet so it floats to the top of the list.
export async function setFavorite(id: number, favorite: boolean): Promise<Snippet | null> {
  if (await useLocalDb()) {
    return invoke<Snippet | null>("set_favorite", { id, favorite });
  }

  const res = await apiFetch(`/api/snippets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ favorite }),
  });
  await throwIfNotOk(res, "Failed to update favorite");
  return res.json();
}

// Record that a snippet was copied (bumps its usage count). Fire-and-forget:
// failures are swallowed so a copy always succeeds even if tracking doesn't.
export async function recordCopy(id: number): Promise<Snippet | null> {
  try {
    if (await useLocalDb()) {
      return await invoke<Snippet | null>("record_copy", { id });
    }
    const res = await apiFetch(`/api/snippets/${id}/copy`, { method: "POST" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Re-insert a deleted snippet, preserving its fields. Backs undo-after-delete.
export async function restoreSnippet(snippet: Snippet): Promise<Snippet | null> {
  if (await useLocalDb()) {
    return invoke<Snippet | null>("restore_snippet", { snippet });
  }

  const res = await apiFetch(`/api/snippets/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snippet),
  });
  await throwIfNotOk(res, "Failed to restore snippet");
  return res.json();
}

// ---- Whole-library export / import ----------------------------------------

// Export the entire library as an array of sync records (uuid, kind, timestamps
// — everything needed to round-trip), for a JSON backup or transfer. Live
// prompts only; tombstones are omitted, since a backup restores your current
// library. Works in both runtimes via the local getSnippets().
export async function exportLibrary(): Promise<SyncRecord[]> {
  const snippets = await getSnippets();
  return snippets.map(({ id: _id, ...rest }) => ({ ...rest, deleted: false }));
}

// Import a library file by merging its records into the local database by uuid,
// newest-`updated_at` winning — the exact reconciliation a sync performs, so
// re-importing updates entries in place instead of duplicating them. Returns
// how many rows were inserted or updated.
export async function importLibrary(records: SyncRecord[]): Promise<number> {
  if (await useLocalDb()) {
    return invoke<number>("apply_sync_records", { records });
  }

  const res = await apiFetch("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ records }),
  });
  await throwIfNotOk(res, "Failed to import library");
  const body = (await res.json()) as { applied: number };
  return body.applied;
}

// ---- Database setup / management (desktop only) ---------------------------

export type InitStatus = {
  initialized: boolean;
  db_path: string | null;
};

// Whether first-run database setup is needed. In the browser there is nothing
// to set up (the web app always uses ./data/snippets.db), so report ready.
export async function getInitStatus(): Promise<InitStatus> {
  if (!isTauri()) return { initialized: true, db_path: null };
  return invoke<InitStatus>("get_init_status");
}

// Create a new database. Pass a path to place it somewhere specific, or omit
// to use the default app-data location.
export async function initializeNewDb(path?: string): Promise<string> {
  return invoke<string>("initialize_new_db", { path: path ?? null });
}

// Adopt an existing snippets.db the user already has.
export async function useExistingDb(path: string): Promise<string> {
  return invoke<string>("use_existing_db", { path });
}

export async function getDatabasePath(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("get_database_path");
}

// Write a copy of the current database to the given destination path.
export async function backupDatabase(destination: string): Promise<string> {
  return invoke<string>("backup_database", { destination });
}

// The managed backups folder (created if missing) — where "Back up now" writes
// timestamped snapshots an external backup tool can watch.
export async function getBackupsDir(): Promise<string> {
  return invoke<string>("get_backups_dir");
}

// Write a timestamped, consistent snapshot into the managed backups folder,
// pruning to the newest `keep` (default handled in Rust). Returns the path.
export async function backupToFolder(keep?: number): Promise<string> {
  return invoke<string>("backup_to_folder", { keep: keep ?? null });
}

// Restore the whole database from a backup file, replacing the current library.
// The file is validated as a SnipVault database in Rust before anything changes.
export async function restoreFromBackup(path: string): Promise<void> {
  await invoke("restore_from_backup", { path });
}

// Open the managed backups folder in the OS file manager.
export async function openBackupsDir(): Promise<void> {
  await invoke("open_backups_dir");
}

// Opt-in automatic-backup settings: whether to snapshot on launch (at most once
// a day) and how many snapshots to keep.
export type BackupSettings = { auto_backup: boolean; keep: number };

export async function getBackupSettings(): Promise<BackupSettings> {
  return invoke<BackupSettings>("get_backup_settings");
}

export async function setBackupSettings(
  autoBackup: boolean,
  keep?: number
): Promise<void> {
  await invoke("set_backup_settings", { autoBackup, keep: keep ?? null });
}

// ---- Quick capture (desktop only) -----------------------------------------
//
// A background tray presence + a global hotkey that summons a small always-on-
// top window to paste-and-save or find-and-copy a prompt without switching to
// the full app. The hotkey/tray live in Rust; these helpers configure them and
// let the quick window dismiss itself.

export type QuickCaptureSettings = {
  enabled: boolean;
  // The active global-hotkey accelerator, e.g. "CmdOrCtrl+Shift+V".
  shortcut: string;
  // The built-in default, so the UI can offer a one-tap reset.
  default_shortcut: string;
};

export async function getQuickCaptureSettings(): Promise<QuickCaptureSettings> {
  return invoke<QuickCaptureSettings>("get_quick_capture_settings");
}

// Enable/disable quick capture and set the hotkey. Rust registers the new
// hotkey before saving, so an invalid accelerator throws and nothing persists.
// Returns the resolved settings (a blank shortcut falls back to the default).
export async function setQuickCaptureSettings(
  enabled: boolean,
  shortcut?: string | null
): Promise<QuickCaptureSettings> {
  return invoke<QuickCaptureSettings>("set_quick_capture_settings", {
    enabled,
    shortcut: shortcut ?? null,
  });
}

// Hide the current (quick-capture) window. No-op outside Tauri.
export async function hideQuickWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}

// Whether this webview is the quick-capture window (routing branches on it).
// Reads the window label, which is embedded in the webview — no IPC/permission.
export async function isQuickWindow(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow().label === "quick";
  } catch {
    return false;
  }
}
